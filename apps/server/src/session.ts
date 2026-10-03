import { AgentId, type DecisionEvent, type MissionPlan, type Objective } from "@ember/domain";
import {
  CrewController,
  ScoutController,
  type AgentController,
  type ControllerConfig,
  type ReservationHooks,
} from "@ember/agents";
import { ReservationService } from "@ember/navigation";
import { Incident, SIM_DEFAULTS, type AgentSpec, type IncidentOptions } from "@ember/simulation";
import { RoadIndex, type PublicMap } from "@ember/simulation/model";

export type ControllerFactory = (spec: AgentSpec, map: PublicMap, config: Partial<ControllerConfig> | undefined) => AgentController | null;

export interface SessionOptions extends IncidentOptions {
  /** Build a controller per agent; return null to leave an agent uncontrolled. Defaults to crews and a scout. */
  readonly factory?: ControllerFactory;
  readonly controllerConfig?: Partial<ControllerConfig>;
  /** Agents that get no controller and simply stay put (e.g. a parked scout in a test). */
  readonly uncontrolled?: readonly string[];
}

export interface LoggedDecision {
  readonly event: DecisionEvent;
  readonly callsign: string;
}

/**
 * Composes the authoritative incident with one independent controller per agent and the
 * shared reservation service. The simulator alone advances the world; controllers see only
 * their own projection plus reservation availability, and everything they decide enters the
 * input log as ordinary inputs.
 */
export class IncidentSession {
  readonly incident: Incident;
  readonly reservations: ReservationService;
  readonly controllers = new Map<AgentId, AgentController>();
  readonly decisions: LoggedDecision[] = [];
  readonly planFailures: { tick: number; agentId: string; reason: string }[] = [];
  /** Real milliseconds a controller took on ticks that produced a plan (replanning latency). */
  readonly replanLatencyMs: number[] = [];
  private readonly road: RoadIndex;
  private readonly hooks: ReservationHooks;

  constructor(options: SessionOptions) {
    this.incident = new Incident(options);
    this.road = new RoadIndex(this.incident.scenario.map);
    this.reservations = new ReservationService(this.road);
    const reservations = this.reservations;
    const failures = this.planFailures;
    this.hooks = {
      oracle: (agent, cls, now) => this.reservations.oracleFor(agent, cls, now),
      reserve: (agent, plan, cls, now) => {
        const result = this.reservations.reserve(agent, plan, cls, now);
        if (result.ok) {
          for (const y of result.yielded) this.controllers.get(y.agentId)?.adoptRevision(y.revisedPlan);
        } else if (result.reason === "no_safe_yield") {
          failures.push({ tick: now, agentId: agent, reason: "no_safe_yield" });
        }
        return result;
      },
      release: (agent) => this.reservations.release(agent),
      stillValid: (agent, now) => this.reservations.stillValid(agent, now),
      get revision() {
        return reservations.revision;
      },
    };
    this.reservations.setYieldHandler((holder, _blocked, now): MissionPlan | null =>
      this.controllers.get(holder)?.proposeYield(now) ?? null,
    );
    const skip = new Set(options.uncontrolled ?? []);
    const factory: ControllerFactory =
      options.factory ??
      ((a, map, config) => {
        const ctor = a.role === "scout" ? ScoutController : CrewController;
        return new ctor({ agentId: a.id, callsign: a.callsign, role: a.role, map, ...(config === undefined ? {} : { config }) });
      });
    for (const a of this.incident.scenario.agents) {
      if (skip.has(a.id)) continue;
      const controller = factory(a, this.incident.scenario.map, options.controllerConfig);
      if (controller !== null) this.controllers.set(a.id, controller);
    }
  }

  /** One authoritative second: sync occupancy, let every controller decide, then step the world. */
  step(): void {
    const inc = this.incident;
    const now = inc.simTimeMs;
    const speed = SIM_DEFAULTS.agentSpeedMps;
    for (const agent of inc.scenario.agents) {
      const proj = inc.projectAgent(agent.id);
      const pos = proj.position;
      if (proj.state === "lost") {
        this.reservations.release(agent.id);
        this.reservations.updateOccupancy(agent.id, null);
      } else if (pos.kind === "edge" && this.road.mustEdge(pos.edgeId).singleCapacity) {
        const edge = this.road.mustEdge(pos.edgeId);
        const remaining = pos.direction === "forward" ? edge.length - pos.distanceAlongPolyline : pos.distanceAlongPolyline;
        this.reservations.updateOccupancy(agent.id, {
          edgeId: pos.edgeId,
          expectedExitMs: now + pos.turnaroundTimeRemaining + (remaining / speed) * 1000,
        });
      } else {
        this.reservations.updateOccupancy(agent.id, null);
      }
    }
    for (const [id, controller] of this.controllers) {
      const t0 = Date.now();
      const out = controller.tick(inc.projectAgent(id), { reservations: this.hooks });
      if (out.orders.length > 0) this.replanLatencyMs.push(Date.now() - t0);
      for (const order of out.orders) inc.submit(order);
      for (const r of out.reports) inc.submit({ kind: "report", agentId: id, text: r.text, urgent: r.urgent });
      const callsign = inc.scenario.agents.find((a) => a.id === id)?.callsign ?? id;
      for (const event of out.decisions) this.decisions.push({ event, callsign });
    }
    inc.advanceTo(now + SIM_DEFAULTS.stepMs);
  }

  runUntil(simMs: number, afterStep?: (session: IncidentSession) => void): void {
    while (!this.incident.ended && this.incident.simTimeMs < simMs) {
      this.step();
      afterStep?.(this);
    }
  }

  /** Coordinator action: deliver one stored observation to one agent, keeping its source and time. */
  relay(observationId: string, toAgentId: string): void {
    this.incident.submit({ kind: "relay", observationId, toAgentId: AgentId.parse(toAgentId) });
  }

  sendObjective(objective: Objective): void {
    this.controllers.get(objective.recipientId)?.receiveObjective(objective);
  }

}
