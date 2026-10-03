import {
  DecisionEvent,
  MissionPlan,
  NodeId,
  SequenceNumber,
  SimTimeMs,
  type AgentId,
  type AgentPosition,
  type DecisionType,
  EdgeId,
  type MissionPlan as MissionPlanT,
  type Objective,
  type SiteId,
} from "@ember/domain";
import { ForecastService, admitsProtection, type ForecastEnsemble, type ForecastEvent } from "@ember/forecast";
import {
  ALWAYS_FREE,
  DEFAULT_NAV_CONFIG,
  certifyPlan,
  planMissions,
  planRetreat,
  planReturn,
  protectionTargets,
  type CertifyFailure,
  type PlanningContext,
  type MissionSearchResult,
  type PriorityClass,
  type RankedMission as RankedMissionT,
} from "@ember/navigation";
import type { AgentProjection, SimInput } from "@ember/simulation";
import { RoadIndex, type PublicMap } from "@ember/simulation/model";
import { defaultKindForRole, domainRoleOf, navConfigFor, type CrewKind, type CrewProfile, profileOf } from "./crew-roles.js";
import { EvidenceTracker } from "./evidence.js";
import { explain } from "./explain.js";
import {
  DEFAULT_CONTROLLER_CONFIG,
  type AgentController,
  type ControllerConfig,
  type ControllerEnvironment,
  type ControllerState,
  type CoordinatorReport,
  type ReportableStatus,
  type TickOutput,
} from "./types.js";

type PlanKind = "mission" | "return" | "emergency" | "halt";

interface ActivePlan {
  readonly plan: MissionPlanT;
  readonly mode: "normal" | "withdrawing" | "retreating";
  readonly kind: PlanKind;
  readonly targetId: string | null;
  readonly workSiteId: SiteId | null;
  readonly score: number;
  readonly committedAtMs: number;
  readonly approachCount: number;
}

export interface ControllerOptions {
  readonly agentId: AgentId;
  readonly callsign: string;
  readonly role: "protection_crew" | "scout";
  /** Optional finer kind. When given, its role must match `role` and planning uses its capabilities. */
  readonly kind?: CrewKind;
  readonly map: PublicMap;
  readonly config?: Partial<ControllerConfig>;
}

/**
 * Autonomous protection-crew decision-maker. Every tick it rechecks the committed plan against
 * its own forecast and directly observed closures; on failure it withdraws, retreats or reports
 * itself stranded without waiting for approval. Coordinator objectives restrict its choices but
 * never override survival action.
 */
export class CrewController implements AgentController {
  readonly agentId: AgentId;
  readonly callsign: string;
  protected readonly role: "protection_crew" | "scout";
  readonly kind: CrewKind;
  protected readonly map: PublicMap;
  protected readonly road: RoadIndex;
  protected readonly cfg: ControllerConfig;
  protected readonly forecast: ForecastService;
  protected readonly evidence: EvidenceTracker;
  protected active: ActivePlan | null = null;
  protected objective: Objective | null = null;
  protected pendingObjective: Objective | null = null;
  protected holding = false;
  protected stranded = false;
  /** Edges the coordinator asked this crew to avoid until resume or a new objective. */
  protected readonly avoidCorridorEdges = new Set<EdgeId>();
  private currentState: ControllerState = "HOLDING";
  private seq = 0;
  private fireDirty = true;
  private evalDirty = true;
  private lastEvalMs = -Infinity;
  private lastSwitchMs = -Infinity;
  private rebuildDueAt: number | null = null;
  private eventPointer = 0;
  private seenObjectives = new Set<string>();
  private lastIdleReason: string | null = null;
  private lastRejectionText: string | null = null;
  private lastReportText: string | null = null;
  private lastProj: AgentProjection | null = null;
  private lastEnv: ControllerEnvironment = {};
  private pendingRevision: MissionPlanT | null = null;

  constructor(options: ControllerOptions) {
    this.agentId = options.agentId;
    this.callsign = options.callsign;
    this.role = options.role;
    if (options.kind !== undefined && domainRoleOf(options.kind) !== options.role) {
      throw new Error(`crew kind ${options.kind} does not match role ${options.role}`);
    }
    this.kind = options.kind ?? defaultKindForRole(options.role);
    this.map = options.map;
    this.road = new RoadIndex(options.map);
    const cfg = { ...DEFAULT_CONTROLLER_CONFIG, ...options.config };
    // Capabilities only reshape planning when a kind was asked for; the default keeps prior behaviour.
    this.cfg = options.kind === undefined ? cfg : { ...cfg, nav: navConfigFor(options.kind, cfg.nav) };
    this.forecast = new ForecastService(options.agentId, options.map, this.cfg.forecast);
    this.evidence = new EvidenceTracker(options.map);
  }

  get profile(): CrewProfile {
    return profileOf(this.kind);
  }

  get state(): ControllerState {
    return this.currentState;
  }

  get currentEnsemble(): ForecastEnsemble | null {
    return this.forecast.current;
  }

  get activePlanId(): string | null {
    return this.active?.plan.id ?? null;
  }

  receiveObjective(objective: Objective): void {
    if (objective.recipientId !== this.agentId || this.seenObjectives.has(objective.id)) return;
    this.seenObjectives.add(objective.id);
    this.pendingObjective = objective;
  }

  resumeAutonomous(): void {
    this.objective = null;
    this.pendingObjective = null;
    this.holding = false;
    this.avoidCorridorEdges.clear();
    this.evalDirty = true;
  }

  // ---------- tick ----------

  tick(proj: AgentProjection, env: ControllerEnvironment = {}): TickOutput {
    const out: TickOutput = { state: "HOLDING", orders: [], decisions: [], reports: [], forecastEvents: [] };
    const now = proj.simTimeMs;
    this.lastProj = proj;
    this.lastEnv = env;
    if (proj.state === "lost") {
      this.currentState = "LOST";
      this.active = null;
      return { ...out, state: "LOST" };
    }
    const fire = this.evidence.ingest(proj.knowledge.observations);
    if (fire) {
      this.fireDirty = true;
      this.evalDirty = true;
    }

    const ensemble = this.refreshForecast(proj, now);
    out.forecastEvents.push(...this.forecast.events.slice(this.eventPointer));
    this.eventPointer = this.forecast.events.length;

    // Reconcile with the simulator: a missing commitment means done, cancelled or rejected.
    if (proj.commitment === null && this.active !== null && now > this.active.committedAtMs) {
      this.active = null;
    }
    if (proj.position.kind === "node" && this.active === null) this.stranded = this.stranded && !this.atRefuge(proj.position);
    if (this.active === null) env.reservations?.release(this.agentId);

    const ctx = this.context(proj, ensemble, env, this.classOfActive());

    if (this.pendingRevision !== null) {
      const revised = this.pendingRevision;
      this.pendingRevision = null;
      const cls = this.classOfActive();
      this.commit(proj, revised, this.active?.mode ?? "normal", this.active?.kind ?? "mission", this.active?.targetId ?? null, this.active?.workSiteId ?? null, this.active?.score ?? 0, out, cls, true);
      this.decide(out, proj, "mission_update", "yielded_to_higher_priority", "revised plan to give up a road slot");
    } else if (this.active !== null && env.reservations !== undefined && !env.reservations.stillValid(this.agentId, now)) {
      this.replanForReservation(proj, ctx, out);
    }

    if (this.pendingObjective !== null) this.handleObjective(this.pendingObjective, proj, ctx, out);
    this.pendingObjective = null;

    if (this.active !== null) {
      this.monitor(proj, ctx, out);
    } else {
      this.chooseWhenIdle(proj, ctx, out);
    }
    this.currentState = this.computeState(proj);
    return { ...out, state: this.currentState };
  }

  // ---------- forecast ----------

  protected refreshForecast(proj: AgentProjection, now: number): ForecastEnsemble {
    const cur = this.forecast.current;
    const refreshMs = this.cfg.forecast?.refreshMs ?? 25_000;
    // While unreliable the prior is re-fitted only on the normal refresh; a rebuild is already pending.
    const settling = cur !== null && cur.reliability === "unreliable" && now - cur.builtAtMs < refreshMs;
    const due = cur === null || (this.fireDirty && !settling) || now - cur.builtAtMs >= refreshMs;
    let ensemble = cur;
    if (due || ensemble === null) {
      ensemble = this.forecast.update(proj.knowledge, now);
      this.fireDirty = false;
    }
    if (ensemble.reliability === "unreliable") {
      if (this.rebuildDueAt === null && this.forecast.needsRebuild(proj.knowledge)) {
        this.rebuildDueAt = now + this.cfg.rebuildLatencyMs;
      }
      if (this.rebuildDueAt !== null && now >= this.rebuildDueAt) {
        ensemble = this.forecast.rebuild(proj.knowledge, now);
        this.rebuildDueAt = null;
        this.evalDirty = true;
      }
    } else {
      this.rebuildDueAt = null;
    }
    return ensemble;
  }

  protected context(
    proj: AgentProjection,
    ensemble: ForecastEnsemble,
    env: ControllerEnvironment,
    cls: PriorityClass = "approach",
  ): PlanningContext {
    const avoid = new Set<EdgeId>(this.avoidCorridorEdges);
    if (this.objective?.kind === "avoid_corridor" && this.objective.targetId !== null) {
      avoid.add(EdgeId.parse(this.objective.targetId));
    }
    return {
      agentId: this.agentId,
      road: this.road,
      ensemble,
      closedCells: this.evidence.closed,
      position: proj.position,
      nowMs: proj.simTimeMs,
      oracle: env.reservations?.oracle(this.agentId, cls, proj.simTimeMs) ?? env.oracle ?? ALWAYS_FREE,
      config: this.cfg.nav ?? DEFAULT_NAV_CONFIG,
      avoidEdges: avoid,
      diagnose: false,
    };
  }

  // ---------- monitoring an active plan ----------

  private monitor(proj: AgentProjection, ctx: PlanningContext, out: TickOutput): void {
    const active = this.active;
    if (active === null) return;
    const legIndex = proj.commitment?.legIndex ?? 0;

    if (this.routeBlocked(active.plan, legIndex, proj.position)) {
      if (active.mode !== "normal" || active.kind === "halt") {
        this.replanEmergency("route_closed_by_observation", proj, ctx, out, active.mode === "normal");
      } else {
        this.withdraw("route_closed_by_observation", proj, ctx, out);
      }
      return;
    }
    if (active.mode !== "normal" || active.kind === "halt") return;

    if (active.workSiteId !== null) {
      const site = this.evidence.siteKnowledge().find((s) => s.siteId === active.workSiteId);
      const phase = this.phaseOf(active, proj);
      if (site?.knownResolved === true && phase !== "return") {
        this.returnNow("target_resolved", proj, ctx, out);
        return;
      }
    }

    const certified = certifyPlan({
      road: this.road,
      ensemble: ctx.ensemble,
      closedCells: this.evidence.closed,
      plan: active.plan,
      position: proj.position,
      legIndex,
      nowMs: proj.simTimeMs,
      ...(this.cfg.nav === undefined ? {} : { config: this.cfg.nav }),
    });
    if (!certified.ok) {
      this.withdraw(reasonOf(certified.failure), proj, ctx, out);
      return;
    }
    this.maybeSwitch(proj, ctx, out);
  }

  private phaseOf(active: ActivePlan, proj: AgentProjection): "approach" | "work" | "return" {
    const c = proj.commitment;
    if (c === null) return "approach";
    if (c.working) return "work";
    const w = active.plan.workInterval;
    return w.endMs > w.startMs && c.legIndex >= active.approachCount && proj.simTimeMs >= w.endMs ? "return" : "approach";
  }

  /** True when any cell the agent still has to cross was directly observed burning or burned. */
  private routeBlocked(plan: MissionPlanT, legIndex: number, position: AgentPosition): boolean {
    const closed = this.evidence.closed;
    if (closed.size === 0) return false;
    for (let i = legIndex; i < plan.timedLegs.length; i++) {
      const leg = plan.timedLegs[i]!;
      const edge = this.road.mustEdge(leg.edgeId);
      let lo = 0;
      let hi = edge.length;
      if (i === legIndex && position.kind === "edge" && position.edgeId === edge.id) {
        const d = position.distanceAlongPolyline;
        if (leg.direction === "forward") lo = d;
        else hi = d;
      }
      for (const c of edge.cells) {
        if (c.endDist < lo || c.startDist > hi) continue;
        // The cell the agent stands in is not ahead of it.
        if (i === legIndex && position.kind === "edge" && c.startDist <= position.distanceAlongPolyline && position.distanceAlongPolyline <= c.endDist) continue;
        if (closed.has(c.cell)) return true;
      }
    }
    return false;
  }

  // ---------- reservations ----------

  /** A physical occupant now overlaps a future slot: replan from the actual position. */
  private replanForReservation(proj: AgentProjection, ctx: PlanningContext, out: TickOutput): void {
    const a = this.active;
    if (a === null) return;
    if (a.mode !== "normal") {
      this.replanEmergency("reservation_conflict", proj, ctx, out, false);
      return;
    }
    if (a.kind === "mission" && a.targetId !== null) {
      const result = this.candidateSearch(ctx, new Set([a.targetId]));
      const chosen = result.best !== null ? this.commitFirst(proj, result, out) : null;
      if (chosen !== null) {
        this.decide(out, proj, "mission_update", "reservation_conflict", `${this.missionVerb(chosen.target.id)} with a revised road slot`);
        return;
      }
    }
    this.returnNow("reservation_conflict", proj, ctx, out);
  }

  proposeYield(_nowMs: number): MissionPlanT | null {
    const proj = this.lastProj;
    const a = this.active;
    const ens = this.forecast.current;
    if (proj === null || a === null || ens === null || !admitsProtection(ens)) return null;
    if (a.mode === "retreating" || a.kind === "halt") return null;
    // Planned against the oracle, which already holds the requester's tentative slot.
    const ctx = this.context({ ...proj, simTimeMs: Math.max(proj.simTimeMs, 0) }, ens, this.lastEnv, this.classOfActive());
    let plan: MissionPlanT | null = null;
    if (a.kind === "mission" && a.targetId !== null) {
      plan = this.candidateSearch(ctx, new Set([a.targetId])).best?.plan ?? null;
    } else {
      plan = planReturn(ctx)?.plan ?? null;
    }
    return plan;
  }

  adoptRevision(plan: MissionPlanT): void {
    this.pendingRevision = plan;
  }

  // ---------- survival responses ----------

  /** The same planning context, but seeing reservations from this priority class's point of view. */
  private asClass(ctx: PlanningContext, cls: PriorityClass): PlanningContext {
    const hooks = this.lastEnv.reservations;
    return hooks === undefined ? ctx : { ...ctx, oracle: hooks.oracle(this.agentId, cls, ctx.nowMs) };
  }

  private withdraw(reason: string, proj: AgentProjection, ctx0: PlanningContext, out: TickOutput): void {
    const ctx = this.asClass(ctx0, "emergency");
    const ret = planReturn(ctx);
    if (ret !== null && this.commit(proj, ret.plan, "withdrawing", "emergency", null, null, 0, out)) {
      this.decide(out, proj, "withdrawal_triggered", reason, `withdrawing to ${ret.refugeNodeId}`);
      this.report(out, explain(this.callsign, { type: "withdrawal_triggered", reasonCode: reason, actualAction: "" }), true);
      return;
    }
    this.retreatOrStrand(reason, proj, ctx, out);
  }

  private returnNow(reason: string, proj: AgentProjection, ctx0: PlanningContext, out: TickOutput): void {
    const ctx = this.asClass(ctx0, "return");
    const ret = planReturn(ctx);
    if (ret !== null && this.commit(proj, ret.plan, "normal", "return", null, null, 0, out)) {
      this.decide(out, proj, "mission_update", reason, `returning to ${ret.refugeNodeId}`);
      this.report(out, explain(this.callsign, { type: "mission_update", reasonCode: reason, actualAction: "returning to refuge" }), false);
      return;
    }
    this.retreatOrStrand("no_normal_return", proj, ctx, out);
  }

  private replanEmergency(reason: string, proj: AgentProjection, ctx0: PlanningContext, out: TickOutput, wasNormal: boolean): void {
    if (wasNormal) {
      this.withdraw(reason, proj, ctx0, out);
      return;
    }
    const ctx = this.asClass(ctx0, "emergency");
    const ret = planReturn(ctx);
    if (ret !== null && this.commit(proj, ret.plan, "withdrawing", "emergency", null, null, 0, out)) {
      this.decide(out, proj, "withdrawal_triggered", reason, `withdrawing to ${ret.refugeNodeId}`);
      return;
    }
    this.retreatOrStrand(reason, proj, ctx, out);
  }

  private retreatOrStrand(reason: string, proj: AgentProjection, ctx: PlanningContext, out: TickOutput): void {
    const retreat = planRetreat(ctx);
    if (retreat !== null) {
      this.stranded = false;
      this.commit(proj, retreat.plan, "retreating", "emergency", null, null, 0, out);
      this.decide(out, proj, "retreat_triggered", "no_normal_return", `retreating to ${retreat.refugeNodeId} (best effort)`);
      this.report(out, explain(this.callsign, { type: "retreat_triggered", reasonCode: "no_normal_return", actualAction: "" }), true);
      return;
    }
    if (!this.stranded) {
      this.stranded = true;
      this.halt(proj, out);
      this.decide(out, proj, "stranded_reported", "no_known_passable_route", "holding position and observing");
      this.report(out, explain(this.callsign, { type: "stranded_reported", reasonCode: "no_known_passable_route", actualAction: "" }), true);
    }
    void reason;
  }

  /**
   * Stop where the agent is, replacing whatever the simulator still holds for it: a stranded agent
   * must not later walk a leg it was told to abandon. A mid-edge emergency stop is allowed only here.
   */
  private halt(proj: AgentProjection, out: TickOutput): void {
    const refuge = this.map.refuges[0]?.nodeId ?? (proj.position.kind === "node" ? proj.position.nodeId : proj.position.edgeId);
    const plan = MissionPlan.parse({
      id: `halt-${this.agentId}-${proj.simTimeMs}`,
      recipientId: this.agentId,
      knowledgeRevision: SequenceNumber.parse(proj.knowledgeRevision),
      timedLegs: [],
      workInterval: { startMs: SimTimeMs.parse(proj.simTimeMs), endMs: SimTimeMs.parse(proj.simTimeMs) },
      refugeId: NodeId.parse(refuge),
      reservationRevision: 0,
      limitingReason: "stranded_halt",
    });
    this.commit(proj, plan, "retreating", "halt", null, null, 0, out);
  }

  // ---------- choosing work ----------

  private atRefuge(position: AgentPosition): boolean {
    return position.kind === "node" && this.road.refugeNodes.has(position.nodeId);
  }

  candidateSearch(ctx: PlanningContext, allowed: ReadonlySet<string> | null): MissionSearchResult {
    const targets = protectionTargets(this.evidence.siteKnowledge(), this.cfg.nav?.crewWorkRate ?? 1, allowed);
    return planMissions(ctx, targets);
  }

  private chooseWhenIdle(proj: AgentProjection, ctx: PlanningContext, out: TickOutput): void {
    const now = proj.simTimeMs;
    const dirty = this.evalDirty || now - this.lastEvalMs >= this.cfg.reassessEveryMs;
    if (!dirty) return;

    if (!this.atRefuge(proj.position)) {
      // Not safe at a refuge and nothing committed: get to one (stranded agents retry on evidence).
      this.evalDirty = false;
      this.lastEvalMs = now;
      this.withdraw(this.stranded ? "no_known_passable_route" : "forecast_wait_unsafe", proj, ctx, out);
      return;
    }
    this.stranded = false;

    if (this.holding) {
      this.evalDirty = false;
      this.lastEvalMs = now;
      return;
    }
    this.evalDirty = false;
    this.lastEvalMs = now;

    const allowed = this.objective?.kind === "protect_site" && this.objective.targetId !== null ? new Set([this.objective.targetId]) : null;
    if (!admitsProtection(ctx.ensemble)) {
      this.noteIdle(proj, "forecast_unreliable", out);
      return;
    }
    const result = this.candidateSearch(ctx, allowed);
    const chosen = result.best !== null ? this.commitFirst(proj, result, out) : null;
    if (chosen !== null) {
      this.lastIdleReason = null;
      const t = chosen.target;
      this.decide(out, proj, "mission_start", "mission_admitted", `${this.missionVerb(t.id)} (work ${Math.round(chosen.workMs / 1000)} s, return to ${chosen.refugeNodeId})`);
      this.report(out, explain(this.callsign, { type: "mission_start", reasonCode: "mission_admitted", actualAction: this.missionVerb(t.id) }), false);
      return;
    }
    if (result.best !== null) {
      this.noteIdle(proj, "reservation_unavailable", out);
      return;
    }
    if (allowed !== null && this.objective !== null) {
      // Reassessed once at refuge: still failing, so reject this revision and resume autonomy.
      const reason = result.limitingReason ?? "no_feasible_mission_in_model";
      this.decide(out, proj, "objective_rejected", reason, `objective ${this.objective.id} cannot be satisfied`);
      this.report(out, explain(this.callsign, { type: "objective_rejected", reasonCode: reason, actualAction: "" }, `(${reason})`), true);
      this.objective = null;
      this.evalDirty = true;
      return;
    }
    this.noteIdle(proj, result.limitingReason ?? "no_feasible_mission_in_model", out);
  }

  private noteIdle(proj: AgentProjection, reason: string, out: TickOutput): void {
    if (this.lastIdleReason === reason) return;
    this.lastIdleReason = reason;
    this.decide(out, proj, "idle", reason, "holding at refuge and reassessing on new evidence");
  }

  private maybeSwitch(proj: AgentProjection, ctx: PlanningContext, out: TickOutput): void {
    const active = this.active;
    if (active === null || active.kind !== "mission" || this.objective !== null || this.holding) return;
    const c = proj.commitment;
    if (c === null || c.working || c.legIndex >= active.approachCount) return;
    const now = proj.simTimeMs;
    if (now - this.lastSwitchMs < this.cfg.switchCooldownMs) return;
    if (!this.evalDirty && now - this.lastEvalMs < this.cfg.reassessEveryMs) return;
    this.lastEvalMs = now;
    this.evalDirty = false;
    const result = this.candidateSearch(ctx, null);
    const best = result.best;
    if (best === null || best.target.id === active.targetId) return;
    if (best.score < active.score * this.cfg.switchMargin) return;
    if (!this.commit(proj, best.plan, "normal", "mission", best.target.id, best.target.siteId, best.score, out)) return;
    this.lastSwitchMs = now;
    this.decide(out, proj, "mission_update", "better_mission_found", `switching to ${this.siteName(best.target.id)}`);
  }

  // ---------- objectives ----------

  private handleObjective(obj: Objective, proj: AgentProjection, ctx: PlanningContext, out: TickOutput): void {
    const reject = (reason: string): void => {
      this.decide(out, proj, "objective_rejected", reason, `objective ${obj.id} rejected; current plan kept`);
      this.report(out, explain(this.callsign, { type: "objective_rejected", reasonCode: reason, actualAction: "" }, `(${reason})`), true);
    };
    switch (obj.kind) {
      case "protect_site": {
        if (obj.targetId === null) return reject("missing_target");
        const sites = this.evidence.siteKnowledge();
        const site = sites.find((s) => s.siteId === obj.targetId);
        if (site === undefined) return reject("unknown_site");
        if (site.knownResolved) return reject("target_resolved");
        const result = this.candidateSearch(ctx, new Set([obj.targetId]));
        if (result.best === null) return reject(result.limitingReason ?? "no_feasible_mission_in_model");
        const hadPlan = this.active !== null;
        this.objective = obj;
        this.holding = false;
        const chosen = this.commitFirst(proj, result, out);
        if (chosen === null) {
          this.objective = null;
          return reject("reservation_unavailable");
        }
        this.decide(out, proj, hadPlan ? "mission_update" : "mission_start", "objective_accepted", `${this.missionVerb(chosen.target.id)} on coordinator objective`);
        return;
      }
      case "avoid_corridor": {
        if (obj.targetId === null) return reject("missing_target");
        this.avoidCorridorEdges.add(EdgeId.parse(obj.targetId));
        this.objective = obj;
        this.holding = false;
        this.evalDirty = true;
        if (this.active !== null && this.active.plan.timedLegs.some((l) => l.edgeId === obj.targetId)) {
          return reject("active_plan_uses_corridor");
        }
        this.decide(out, proj, "mission_update", "objective_accepted", `avoiding corridor ${obj.targetId}`);
        return;
      }
      case "return_to_refuge":
      case "hold": {
        if (this.atRefuge(proj.position) && this.active === null) {
          this.holding = obj.kind === "hold";
          this.objective = obj.kind === "hold" ? obj : null;
          return;
        }
        const ret = planReturn(ctx);
        if (ret === null) return reject("no_normal_return");
        if (!this.commit(proj, ret.plan, "normal", "return", null, null, 0, out)) return reject("reservation_unavailable");
        this.holding = obj.kind === "hold";
        this.objective = obj.kind === "hold" ? obj : null;
        this.decide(out, proj, "mission_update", "objective_accepted", `returning to ${ret.refugeNodeId} on coordinator objective`);
        return;
      }
      default:
        return reject("objective_not_supported");
    }
  }

  // ---------- helpers ----------

  protected missionVerb(id: string): string {
    return `heading to ${this.siteName(id)}`;
  }

  protected siteName(id: string): string {
    return this.map.sites.find((s) => s.id === id)?.name ?? id;
  }

  protected classOfActive(): PriorityClass {
    const a = this.active;
    if (a !== null && a.mode !== "normal") return "emergency";
    if (a !== null && a.kind === "return") return "return";
    return this.role === "scout" ? "scout" : "approach";
  }

  private classFor(mode: "normal" | "withdrawing" | "retreating", kind: PlanKind): PriorityClass {
    if (mode !== "normal") return "emergency";
    if (kind === "return") return "return";
    return this.role === "scout" ? "scout" : "approach";
  }

  /**
   * Commit a plan to the simulator. When a reservation service is present the plan's
   * single-capacity slots are reserved first; a denied normal plan is not committed. Emergency
   * plans are best effort: physical occupancy still rules, and nothing is invented.
   */
  protected commit(
    proj: AgentProjection,
    plan: MissionPlanT,
    mode: "normal" | "withdrawing" | "retreating",
    kind: PlanKind,
    targetId: string | null,
    workSiteId: SiteId | null,
    score: number,
    out: TickOutput,
    cls: PriorityClass = this.classFor(mode, kind),
    alreadyReserved = false,
  ): boolean {
    const hooks = this.lastEnv.reservations;
    if (hooks !== undefined && !alreadyReserved) {
      const res = hooks.reserve(this.agentId, plan, cls, proj.simTimeMs);
      if (!res.ok && mode !== "retreating" && kind !== "halt") return false;
    }
    const stamped = MissionPlan.parse({ ...plan, knowledgeRevision: SequenceNumber.parse(proj.knowledgeRevision) });
    const hasWork = stamped.workInterval.endMs > stamped.workInterval.startMs;
    const approachCount = hasWork
      ? stamped.timedLegs.filter((l) => l.departMs < stamped.workInterval.startMs).length
      : stamped.timedLegs.length;
    this.active = { plan: stamped, mode, kind, targetId, workSiteId, score, committedAtMs: proj.simTimeMs, approachCount };
    const order: SimInput = { kind: "commit_plan", agentId: this.agentId, plan: stamped, workSiteId, mode };
    out.orders.push(order);
    this.evalDirty = false;
    return true;
  }

  /** Commit the first admissible candidate whose reservations can be granted. */
  protected commitFirst(proj: AgentProjection, result: MissionSearchResult, out: TickOutput): RankedMissionT | null {
    for (const cand of result.candidates.slice(0, 20)) {
      const t = cand.target;
      if (this.commit(proj, cand.plan, "normal", "mission", t.id, t.siteId, cand.score, out)) return cand;
    }
    return null;
  }

  protected decide(out: TickOutput, proj: AgentProjection, type: DecisionType, reasonCode: string, actualAction: string): void {
    if (type === "objective_rejected") this.lastRejectionText = `${reasonCode}: ${actualAction}`;
    out.decisions.push(
      DecisionEvent.parse({
        sequence: SequenceNumber.parse(this.seq++),
        tick: SimTimeMs.parse(proj.simTimeMs),
        agentId: this.agentId,
        type,
        reasonCode,
        evidenceIds: this.evidence.supportingObservationIds(),
        actualAction,
      }),
    );
  }

  protected report(out: TickOutput, text: string, urgent: boolean): void {
    this.lastReportText = text;
    const entry: CoordinatorReport = { text, urgent };
    out.reports.push(entry);
  }

  status(proj: AgentProjection): ReportableStatus {
    const a = this.active;
    const verbs: Record<ControllerState, string | null> = {
      HOLDING: "holding at refuge",
      PLANNING: "planning",
      APPROACHING: "approaching its work site",
      WORKING: "working",
      RETURNING: "returning to refuge",
      WITHDRAWING: "withdrawing to refuge",
      RETREATING: "retreating to refuge",
      STRANDED: "stranded with no known passable route",
      LOST: null,
    };
    const last = a === null ? null : a.plan.timedLegs[a.plan.timedLegs.length - 1];
    const targetName = a?.targetId == null ? null : this.siteName(a.targetId);
    return {
      callsign: this.callsign,
      currentAction: verbs[this.computeState(proj)] === null ? null : `${verbs[this.computeState(proj)]}${targetName !== null && this.computeState(proj) !== "HOLDING" ? ` (${targetName})` : ""}`,
      objective: this.objective === null ? null : `${this.objective.kind}${this.objective.targetId === null ? "" : ` ${this.objective.targetId}`}`,
      returnEstimateSec: last === undefined || last === null ? null : Math.max(0, (last.arriveMs - proj.simTimeMs) / 1000),
      lastRejection: this.lastRejectionText,
      knownConditions: this.evidence.closed.size === 0 ? null : `${this.evidence.closed.size} cells observed burning or burned`,
      lastReport: this.lastReportText,
    };
  }

  private computeState(proj: AgentProjection): ControllerState {
    if (proj.state === "lost") return "LOST";
    const a = this.active;
    if (a === null) {
      if (this.stranded) return "STRANDED";
      return this.atRefuge(proj.position) ? "HOLDING" : "PLANNING";
    }
    if (a.mode === "withdrawing") return "WITHDRAWING";
    if (a.mode === "retreating") return a.kind === "halt" ? "STRANDED" : "RETREATING";
    if (a.kind === "return") return "RETURNING";
    const c = proj.commitment;
    if (c !== null && c.working) return "WORKING";
    const hasWork = a.plan.workInterval.endMs > a.plan.workInterval.startMs;
    if (hasWork && c !== null && c.legIndex >= a.approachCount) return "RETURNING";
    return "APPROACHING";
  }
}

function reasonOf(failure: CertifyFailure | null): string {
  switch (failure?.kind) {
    case "leg":
      return "forecast_leg_unsafe";
    case "wait":
      return "forecast_wait_unsafe";
    case "work":
      return "forecast_work_unsafe";
    case "horizon":
      return "forecast_horizon";
    case "forecast_unreliable":
      return "forecast_unreliable";
    default:
      return "forecast_leg_unsafe";
  }
}

export type { ForecastEvent };
