import type { AgentId, AgentPosition, AgentState, EdgeId, MissionPlan, NodeId, SiteId } from "@ember/domain";
import { EdgePosition, Meters, SimTimeMs } from "@ember/domain";
import {
  CELL_BURNED,
  CELL_BURNING,
  CELL_NONBURNABLE,
  CELL_UNBURNED,
  FireField,
  RoadIndex,
  SIM_DEFAULTS,
  cellCenter,
  cellIndexOf,
  cellsWithin,
  createTerrain,
  refugeCells,
  streamRng,
  type FireParams,
  type RoadEdge,
} from "./model/index.js";
import type { PlanMode } from "./inputs.js";
import type { AgentSpec, SimScenario } from "./scenario.js";

export interface PrivateWorldParameters {
  readonly spreadMultiplier: number;
  readonly initialWindRad: number;
  readonly windShiftMs: number;
  readonly postShiftWindRad: number;
}

/** Test and calibration overrides for the seeded private parameters. */
export interface PrivateOverrides {
  readonly spreadMultiplier?: number | undefined;
  readonly initialWindRad?: number | undefined;
  readonly windShiftMs?: number | undefined;
  readonly postShiftWindRad?: number | undefined;
}

/** Seeded private parameters from the world stream. These never leave the simulator. */
export function derivePrivateParameters(seed: string, overrides: PrivateOverrides = {}): PrivateWorldParameters {
  const rng = streamRng(seed, "world");
  const d = SIM_DEFAULTS;
  const spreadMultiplier = rng.range(d.spreadMultiplierRange[0], d.spreadMultiplierRange[1]);
  const windShiftMs = Math.round(rng.range(d.windShiftTimeRangeMs[0], d.windShiftTimeRangeMs[1]) / 1000) * 1000;
  const jitter = rng.range(-d.initialWindJitterDeg, d.initialWindJitterDeg);
  const postShift = rng.range(d.postShiftRangeDeg[0], d.postShiftRangeDeg[1]);
  return {
    spreadMultiplier: overrides.spreadMultiplier ?? spreadMultiplier,
    initialWindRad: overrides.initialWindRad ?? (jitter * Math.PI) / 180,
    windShiftMs: overrides.windShiftMs ?? windShiftMs,
    postShiftWindRad: overrides.postShiftWindRad ?? (postShift * Math.PI) / 180,
  };
}

type Pos =
  | { kind: "node"; nodeId: NodeId }
  | { kind: "edge"; edgeId: EdgeId; dist: number; direction: "forward" | "reverse"; turnMs: number };

interface Commitment {
  plan: MissionPlan;
  workSiteId: SiteId | null;
  mode: PlanMode;
  legIndex: number;
  approachCount: number;
  hasWork: boolean;
  blockedNoticed: boolean;
}

export interface TruthAgent {
  readonly id: AgentId;
  readonly role: AgentSpec["role"];
  readonly callsign: string;
  pos: Pos;
  state: AgentState;
  commitment: Commitment | null;
  working: boolean;
  objectiveRevision: number;
  planRevision: number;
  lostAtMs: number | null;
}

export interface TruthSite {
  readonly id: SiteId;
  readonly name: string;
  readonly nodeId: NodeId;
  readonly requiredWork: number;
  readonly value: number;
  completedWork: number;
  damage: number;
  destroyed: boolean;
  resolvedNoticed: boolean;
  readonly exposureCells: readonly number[];
}

export type SimNotice =
  | { tick: number; kind: "plan_accepted"; agentId: AgentId; planId: string }
  | { tick: number; kind: "plan_rejected"; agentId: AgentId; reason: string }
  | { tick: number; kind: "plan_cancelled"; agentId: AgentId; planId: string; reason: string }
  | { tick: number; kind: "plan_complete"; agentId: AgentId; planId: string }
  | { tick: number; kind: "entry_blocked"; agentId: AgentId; edgeId: EdgeId }
  | { tick: number; kind: "agent_lost"; agentId: AgentId }
  | { tick: number; kind: "site_resolved"; siteId: SiteId; how: "protected" | "destroyed" }
  | { tick: number; kind: "edge_closed"; edgeId: EdgeId };

export interface CommitResult {
  readonly accepted: boolean;
  readonly reason: string | null;
}

const STEP = SIM_DEFAULTS.stepMs;

/** Authoritative truth state. Only this class mutates it, one fixed step at a time. */
export class World {
  readonly road: RoadIndex;
  readonly fire: FireField;
  readonly params: FireParams;
  readonly agents: TruthAgent[] = [];
  readonly sites: TruthSite[] = [];
  readonly closedEdges = new Set<EdgeId>();
  readonly notices: SimNotice[] = [];
  timeMs = 0;

  constructor(scenario: SimScenario, privateParams: PrivateWorldParameters) {
    this.road = new RoadIndex(scenario.map);
    this.params = privateParams;
    const terrain = createTerrain(scenario.map.terrainSeed);
    this.fire = new FireField(terrain, refugeCells(this.road, SIM_DEFAULTS.refugeRadiusM));
    this.fire.ignite(scenario.map.initialFireCells, 0);
    this.refreshClosedEdges(scenario.map.initialFireCells);
    for (const spec of scenario.agents) {
      this.agents.push({
        id: spec.id,
        role: spec.role,
        callsign: spec.callsign,
        pos: { kind: "node", nodeId: spec.startNodeId },
        state: "idle",
        commitment: null,
        working: false,
        objectiveRevision: 0,
        planRevision: 0,
        lostAtMs: null,
      });
    }
    for (const site of scenario.map.sites) {
      const p = this.road.nodePoint(site.nodeId);
      this.sites.push({
        id: site.id,
        name: site.name,
        nodeId: site.nodeId,
        requiredWork: site.requiredWork,
        value: site.value,
        completedWork: 0,
        damage: 0,
        destroyed: false,
        resolvedNoticed: false,
        exposureCells: cellsWithin(p.x, p.y, SIM_DEFAULTS.siteExposureRadiusM),
      });
    }
  }

  agent(id: AgentId): TruthAgent {
    const found = this.agents.find((a) => a.id === id);
    if (found === undefined) throw new Error(`unknown agent ${id}`);
    return found;
  }

  agentPoint(agent: TruthAgent): { x: number; y: number } {
    if (agent.pos.kind === "node") return this.road.nodePoint(agent.pos.nodeId);
    return this.road.pointAlong(this.road.mustEdge(agent.pos.edgeId), agent.pos.dist);
  }

  siteResolved(site: TruthSite): boolean {
    return site.destroyed || site.completedWork >= site.requiredWork;
  }

  livingCrews(): TruthAgent[] {
    return this.agents.filter((a) => a.role === "protection_crew" && a.state !== "lost");
  }

  occupantsOf(edgeId: EdgeId): TruthAgent[] {
    return this.agents.filter((a) => a.state !== "lost" && a.pos.kind === "edge" && a.pos.edgeId === edgeId);
  }

  // ---------- plan commitment (step 2: applied after revalidation) ----------

  commit(agentId: AgentId, plan: MissionPlan, workSiteId: SiteId | null, mode: PlanMode): CommitResult {
    const agent = this.agent(agentId);
    const reject = (reason: string): CommitResult => {
      this.notices.push({ tick: this.timeMs, kind: "plan_rejected", agentId, reason });
      return { accepted: false, reason };
    };
    if (agent.state === "lost") return reject("agent_lost");
    if (plan.recipientId !== agentId) return reject("recipient_mismatch");

    const legs = plan.timedLegs;
    const hasWork = plan.workInterval.endMs > plan.workInterval.startMs;
    const approachCount = hasWork ? legs.filter((l) => l.departMs < plan.workInterval.startMs).length : legs.length;

    let cursor: NodeId | null = null;
    if (agent.pos.kind === "node") cursor = agent.pos.nodeId;
    for (let i = 0; i < legs.length; i++) {
      const leg = legs[i];
      if (leg === undefined) continue;
      const edge = this.road.edges.get(leg.edgeId);
      if (edge === undefined) return reject("unknown_edge");
      if (cursor === null) {
        // Agent is mid-edge: the first leg must be the edge it is on.
        if (i !== 0 || agent.pos.kind !== "edge" || agent.pos.edgeId !== leg.edgeId) return reject("leg_not_connected");
      } else {
        const start = leg.direction === "forward" ? edge.from : edge.to;
        if (start !== cursor) return reject("leg_not_connected");
      }
      cursor = leg.direction === "forward" ? edge.to : edge.from;
      if (i === approachCount - 1 && hasWork && workSiteId !== null) {
        const site = this.sites.find((s) => s.id === workSiteId);
        if (site === undefined || site.nodeId !== cursor) return reject("work_site_not_at_approach_end");
      }
    }
    if (hasWork && workSiteId !== null) {
      const site = this.sites.find((s) => s.id === workSiteId);
      if (site === undefined) return reject("unknown_site");
      if (approachCount === 0 && !(agent.pos.kind === "node" && agent.pos.nodeId === site.nodeId)) {
        return reject("work_site_not_at_approach_end");
      }
    }

    if (agent.pos.kind === "edge" && legs.length > 0) {
      const first = legs[0];
      if (first !== undefined && first.direction !== agent.pos.direction) {
        // Reversal keeps edge occupancy through the turnaround delay.
        agent.pos.direction = first.direction;
        agent.pos.turnMs = SIM_DEFAULTS.turnaroundMs;
      }
    }

    const previous = agent.commitment;
    if (previous !== null) {
      this.notices.push({
        tick: this.timeMs,
        kind: "plan_cancelled",
        agentId,
        planId: previous.plan.id,
        reason: "superseded",
      });
    }
    agent.commitment = { plan, workSiteId, mode, legIndex: 0, approachCount, hasWork, blockedNoticed: false };
    agent.planRevision += 1;
    agent.working = false;
    this.notices.push({ tick: this.timeMs, kind: "plan_accepted", agentId, planId: plan.id });
    this.refreshState(agent);
    return { accepted: true, reason: null };
  }

  // ---------- one authoritative step (steps 3-5 of the documented order) ----------

  step(): void {
    const from = this.timeMs;
    const to = from + STEP;
    // 3. wind and fire
    const ignited = this.fire.step(to, STEP, this.params);
    this.refreshClosedEdges(ignited);
    // 4. movement, then loss detection along the traversed interval
    for (const agent of this.agents) {
      if (agent.state === "lost") continue;
      this.moveAgent(agent, from);
    }
    // 5. work, then site damage and destruction
    this.applyWorkAndDamage();
    this.timeMs = to;
    for (const agent of this.agents) {
      if (agent.state !== "lost") this.refreshState(agent);
    }
  }

  private refreshClosedEdges(cells: readonly number[]): void {
    for (const cell of cells) {
      for (const edgeId of this.road.edgesByCell.get(cell) ?? []) {
        if (!this.closedEdges.has(edgeId)) {
          this.closedEdges.add(edgeId);
          this.notices.push({ tick: this.timeMs + STEP, kind: "edge_closed", edgeId });
        }
      }
    }
  }

  private isBurningAt(x: number, y: number): boolean {
    const cell = cellIndexOf(x, y);
    return cell !== null && this.fire.state[cell] === CELL_BURNING;
  }

  private lose(agent: TruthAgent, atMs: number): void {
    if (agent.commitment !== null) {
      this.notices.push({
        tick: atMs,
        kind: "plan_cancelled",
        agentId: agent.id,
        planId: agent.commitment.plan.id,
        reason: "agent_lost",
      });
    }
    agent.state = "lost";
    agent.commitment = null;
    agent.working = false;
    agent.lostAtMs = atMs;
    this.notices.push({ tick: atMs, kind: "agent_lost", agentId: agent.id });
  }

  private moveAgent(agent: TruthAgent, stepStartMs: number): void {
    const stepEndMs = stepStartMs + STEP;
    agent.working = false;
    const c = agent.commitment;

    if (agent.pos.kind === "node" && c !== null) {
      this.advanceFromNode(agent, c, stepStartMs);
    }

    if (agent.pos.kind === "edge") {
      const pos = agent.pos;
      if (pos.turnMs > 0) {
        pos.turnMs = Math.max(0, pos.turnMs - STEP);
      } else if (agent.commitment !== null) {
        // An agent mid-edge with no commitment keeps still (forced emergency stop).
        this.travel(agent, pos, SIM_DEFAULTS.agentSpeedMps * (STEP / 1000));
      }
    }

    // Loss check covers the endpoint after movement; travel() checks the swept path.
    if (agent.state !== "lost") {
      const p = this.agentPoint(agent);
      if (this.isBurningAt(p.x, p.y)) this.lose(agent, stepEndMs);
    }
  }

  /** Departure from a node, work dwell, or completion of the committed plan. */
  private advanceFromNode(agent: TruthAgent, c: Commitment, stepStartMs: number): void {
    const plan = c.plan;
    const atApproachEnd = c.legIndex >= c.approachCount;
    if (c.hasWork && atApproachEnd && stepStartMs < plan.workInterval.endMs) {
      agent.working = true;
      return;
    }
    const leg = plan.timedLegs[c.legIndex];
    if (leg === undefined) {
      if (c.hasWork && stepStartMs < plan.workInterval.endMs) return;
      this.notices.push({ tick: stepStartMs + STEP, kind: "plan_complete", agentId: agent.id, planId: plan.id });
      agent.commitment = null;
      return;
    }
    if (stepStartMs < leg.departMs) return;
    const edge = this.road.mustEdge(leg.edgeId);
    if (this.closedEdges.has(edge.id)) {
      this.cancel(agent, c, "edge_closed", stepStartMs + STEP);
      return;
    }
    if (edge.singleCapacity && this.occupantsOf(edge.id).length > 0) {
      if (!c.blockedNoticed) {
        c.blockedNoticed = true;
        this.notices.push({ tick: stepStartMs + STEP, kind: "entry_blocked", agentId: agent.id, edgeId: edge.id });
      }
      return;
    }
    c.blockedNoticed = false;
    agent.pos = {
      kind: "edge",
      edgeId: edge.id,
      dist: leg.direction === "forward" ? 0 : edge.length,
      direction: leg.direction,
      turnMs: 0,
    };
  }

  private cancel(agent: TruthAgent, c: Commitment, reason: string, tick: number): void {
    this.notices.push({ tick, kind: "plan_cancelled", agentId: agent.id, planId: c.plan.id, reason });
    agent.commitment = null;
  }

  /** Move along the current edge, checking the swept path so no active cell is skipped. */
  private travel(agent: TruthAgent, pos: Extract<Pos, { kind: "edge" }>, meters: number): void {
    const edge: RoadEdge = this.road.mustEdge(pos.edgeId);
    const sign = pos.direction === "forward" ? 1 : -1;
    const startDist = pos.dist;
    const target = Math.min(edge.length, Math.max(0, startDist + sign * meters));
    const span = Math.abs(target - startDist);
    const samples = Math.max(1, Math.ceil(span));
    for (let i = 1; i <= samples; i++) {
      const d = startDist + (sign * span * i) / samples;
      const p = this.road.pointAlong(edge, d);
      if (this.isBurningAt(p.x, p.y)) {
        pos.dist = d;
        this.lose(agent, this.timeMs + STEP);
        return;
      }
    }
    pos.dist = target;
    const arrived = pos.direction === "forward" ? target >= edge.length : target <= 0;
    if (arrived) {
      const nodeId = pos.direction === "forward" ? edge.to : edge.from;
      agent.pos = { kind: "node", nodeId };
      const c = agent.commitment;
      if (c !== null) c.legIndex += 1;
    }
  }

  private applyWorkAndDamage(): void {
    const dt = STEP / 1000;
    for (const site of this.sites) {
      if (!site.destroyed && site.completedWork < site.requiredWork) {
        let rate = 0;
        for (const a of this.agents) {
          if (a.state === "lost" || a.role !== "protection_crew" || !a.working) continue;
          if (a.commitment?.workSiteId === site.id) rate += SIM_DEFAULTS.crewWorkRate;
        }
        if (rate > 0) site.completedWork = Math.min(site.requiredWork, site.completedWork + dt * rate);
      }
      if (!site.destroyed) {
        const exposed = site.exposureCells.some((c) => this.fire.state[c] === CELL_BURNING);
        if (exposed) {
          const p = site.completedWork / site.requiredWork;
          const damageRate = SIM_DEFAULTS.unprotectedDamageRate * (1 - SIM_DEFAULTS.maxDamageReduction * p);
          site.damage = Math.min(1, site.damage + dt * damageRate);
          if (site.damage >= 1) site.destroyed = true;
        }
      }
      if (!site.resolvedNoticed && this.siteResolved(site)) {
        site.resolvedNoticed = true;
        this.notices.push({
          tick: this.timeMs + STEP,
          kind: "site_resolved",
          siteId: site.id,
          how: site.destroyed ? "destroyed" : "protected",
        });
      }
    }
  }

  private refreshState(agent: TruthAgent): void {
    if (agent.state === "lost") return;
    const c = agent.commitment;
    if (c === null) {
      agent.state = "idle";
    } else if (agent.working) {
      agent.state = "working";
    } else if (c.mode === "withdrawing") {
      agent.state = "withdrawing";
    } else if (c.mode === "retreating") {
      agent.state = "retreating";
    } else {
      agent.state = "approaching";
    }
  }

  toAgentPosition(agent: TruthAgent): AgentPosition {
    if (agent.pos.kind === "node") return { kind: "node", nodeId: agent.pos.nodeId };
    return EdgePosition.parse({
      kind: "edge",
      edgeId: agent.pos.edgeId,
      distanceAlongPolyline: Meters.parse(agent.pos.dist),
      direction: agent.pos.direction,
      turnaroundTimeRemaining: SimTimeMs.parse(agent.pos.turnMs),
    });
  }

  burnStateAt(cell: number): "unburned" | "burning" | "burned" {
    const s = this.fire.state[cell];
    if (s === CELL_BURNING) return "burning";
    if (s === CELL_BURNED) return "burned";
    return "unburned";
  }

  /** Nonburnable cells report as unburned to any observer. */
  isNonburnable(cell: number): boolean {
    return this.fire.state[cell] === CELL_NONBURNABLE;
  }

  cellPoint(cell: number): { x: number; y: number } {
    return cellCenter(cell);
  }

  unburnedCount(): number {
    let n = 0;
    for (let i = 0; i < this.fire.state.length; i++) if (this.fire.state[i] === CELL_UNBURNED) n += 1;
    return n;
  }
}
