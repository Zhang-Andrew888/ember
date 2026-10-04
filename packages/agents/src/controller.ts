import {
  DecisionEvent,
  MissionPlan,
  NodeId,
  SequenceNumber,
  SimTimeMs,
  scheduledLegCount,
  type AgentId,
  type AgentPosition,
  type AgentRole,
  type CompassDirection,
  type MapPoint,
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
  directionalTargets,
  planDirectionalMove,
  containmentTargets,
  firelineTarget,
  mergeBurnCellLists,
  planMissions,
  pathClearanceM,
  planHoseInPlace,
  planRejoinRoad,
  planRetreat,
  planReturn,
  protectionTargets,
  type CertifyFailure,
  type ContainmentLine,
  type FirelineRefusal,
  type MissionTarget,
  type PlanningContext,
  type MissionSearchResult,
  type PriorityClass,
  type RankedMission as RankedMissionT,
} from "@ember/navigation";
import type { AgentProjection, SimInput } from "@ember/simulation";
import {
  GAME_CHANGES,
  RoadIndex,
  SIM_DEFAULTS,
  cellCenter,
  cellsWithin,
  gameBrigadeJoinRadiusM,
  gameHoseRadiusM,
  gameLineCellRadiusM,
  type PublicMap,
} from "@ember/simulation/model";
import {
  patrolDirectionsForAgent,
  preferSiteWhenThreatened,
  rankContainmentCandidates,
  shouldSplitBrigadeLine,
  shouldYieldCell,
} from "./brigade.js";
import { capabilitiesOf, type CrewCapabilities } from "./crew-roles.js";
import { decideContinuation, decideOrder } from "./autonomy.js";
import { EvidenceTracker } from "./evidence.js";
import { applyStyle, type CommStyle } from "./style.js";
import { explain } from "./explain.js";
import { lineEndWords } from "./line-words.js";
import { planStandoffPoint, type BrigadePeer } from "./peer-suppress.js";
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

/** A line end counts as "at" a named place when it lies within this distance of it. */
const NAMED_PLACE_REACH_M = 150;

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
  readonly role: AgentRole;
  readonly map: PublicMap;
  readonly gameChanges?: boolean;
  readonly config?: Partial<ControllerConfig>;
  /** How this agent words its reports; plain by default. */
  readonly style?: CommStyle;
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
  protected readonly role: AgentRole;
  readonly style: CommStyle;
  protected readonly map: PublicMap;
  protected readonly road: RoadIndex;
  protected readonly cfg: ControllerConfig;
  protected readonly forecast: ForecastService;
  protected readonly evidence: EvidenceTracker;
  protected readonly gameChanges: boolean;
  protected active: ActivePlan | null = null;
  protected objective: Objective | null = null;
  /** Distinct objectives received since the last tick, in arrival order. */
  private readonly pendingObjectives: Objective[] = [];
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
  /** Completed patrols; rotates the heading so repeat patrols cover new ground. */
  private patrolRound = 0;
  /** Road nodes this crew has already patrolled to (its own exploration memory). */
  private readonly patrolledNodes = new Set<string>();

  constructor(options: ControllerOptions) {
    this.agentId = options.agentId;
    this.callsign = options.callsign;
    this.role = options.role;
    this.style = options.style ?? "plain";
    this.map = options.map;
    this.gameChanges = options.gameChanges === true;
    this.road = new RoadIndex(options.map);
    this.cfg = { ...DEFAULT_CONTROLLER_CONFIG, ...options.config };
    this.forecast = new ForecastService(options.agentId, options.map, this.cfg.forecast);
    this.evidence = new EvidenceTracker(options.map);
  }

  /** This role's documented speed and work rate. */
  get capabilities(): CrewCapabilities {
    return capabilitiesOf(this.role);
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
    this.pendingObjectives.push(objective);
  }

  resumeAutonomous(): void {
    this.objective = null;
    this.pendingObjectives.length = 0;
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
    for (const next of this.pendingObjectives.splice(0)) {
      const ensembleEarly = this.forecast.current ?? this.refreshForecast(proj, now);
      this.handleObjective(next, proj, this.context(proj, ensembleEarly, env, this.classOfActive()), out);
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
      // One-shot orders: a directional move or one fire-line shift ends with its mission.
      if (this.objective?.kind === "move_direction" || this.objective?.kind === "build_line") this.objective = null;
      const work = this.active.plan.work;
      // Game-changes crews see 150 m (beyond hose reach), so an extinguished cell arrives as a burned
      // sighting; retiring it here would make them forget a cell that is still burning.
      if (work?.kind === "suppress_fire" && !this.gameChanges) this.evidence.retireContainmentCell(work.gridCellIndex, now);
      this.active = null;
      // Pick the next job this tick instead of waiting for the periodic reassessment.
      if (this.gameChanges) this.evalDirty = true;
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
      gameChanges: this.gameChanges,
      ...(env.peerSuppressCells === undefined ? {} : { peerSuppressCells: env.peerSuppressCells }),
      ...(env.brigadePeer === undefined ? {} : { brigadePeer: env.brigadePeer }),
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
        this.withdrawPer(this.continuation(active, proj, ctx, true, null), proj, ctx, out);
      }
      return;
    }
    if (active.mode !== "normal" || active.kind === "halt") {
      // Game-changes: a halted crew keeps looking for work (and wakes at once on new fire evidence).
      if (this.gameChanges && active.kind === "halt" && (this.evalDirty || proj.simTimeMs - this.lastEvalMs >= this.cfg.reassessEveryMs)) {
        this.evalDirty = false;
        this.lastEvalMs = proj.simTimeMs;
        this.seekWork(proj, ctx, out);
      }
      return;
    }

    if (active.workSiteId !== null) {
      const site = this.evidence.siteKnowledge().find((s) => s.siteId === active.workSiteId);
      const phase = this.phaseOf(active, proj);
      if (site?.knownResolved === true && phase !== "return") {
        this.returnNow("target_resolved", proj, ctx, out);
        return;
      }
    }

    // Off-road legs are not re-routed mid-drive, so a crew that sees fire beside its remaining
    // path stops and picks again (usually hosing that fire from where it is).
    if (this.gameChanges && proj.commitment?.working !== true && this.offroadPathThreatened(proj)) {
      this.lastEvalMs = proj.simTimeMs;
      this.seekWork(proj, ctx, out);
      if (out.orders.length > 0) return;
    }
    // Game-changes crews on fire keep coordinating even while their current plan fails re-certification
    // (fire-first crews carry on through that); a replacement plan passes its own admission.
    if (this.maybeJoinLine(proj, ctx, out)) return;
    if (this.maybeSplitFromPeer(proj, ctx, out)) return;

    const fireFirst = this.commitsFireFirst(active.plan);
    const certified = certifyPlan({
      road: this.road,
      ensemble: ctx.ensemble,
      closedCells: this.evidence.closed,
      plan: active.plan,
      position: proj.position,
      legIndex,
      nowMs: proj.simTimeMs,
      ...(this.cfg.nav === undefined ? {} : { config: this.cfg.nav }),
      ...(fireFirst ? { fireFirst: true, ignoreReliability: true } : {}),
    });
    if (!certified.ok) {
      this.withdrawPer(this.continuation(active, proj, ctx, false, reasonOf(certified.failure)), proj, ctx, out);
      return;
    }
    this.maybeSwitch(proj, ctx, out);
  }

  /**
   * Game-changes line: the nearest crew this one can see (within the join radius) that is already
   * hosing fire, so every hose sprays the same front from the same side. A crew already fighting
   * only joins a lower-id crew, so two lines never chase each other.
   */
  private lineToJoin(position: AgentPosition): JoinableLine | null {
    const peers = this.lastEnv.brigadePeer?.peers;
    if (!this.gameChanges || peers === undefined) return null;
    const me = this.pointOf(position);
    const fighting = this.active?.kind === "mission" && this.active.plan.work?.kind === "suppress_fire";
    let anchor: BrigadePeer | null = null;
    let anchorDist = Infinity;
    for (const p of peers) {
      if (p.cell === null || p.standoff === null || p.point === null) continue;
      if (fighting && !(p.agentId < this.agentId)) continue;
      // Line up beside a crew working the fire, not behind one still driving there.
      const pc = cellCenter(p.cell);
      if (!p.spraying && Math.hypot(p.point.x - pc.x, p.point.y - pc.y) > gameHoseRadiusM()) continue;
      const d = Math.hypot(p.point.x - me.x, p.point.y - me.y);
      if (d <= gameBrigadeJoinRadiusM() && d < anchorDist) {
        anchor = p;
        anchorDist = d;
      }
    }
    const from = anchor === null ? null : sprayPointOf(anchor);
    if (anchor === null || anchor.cell === null || from === null) return null;
    const c = cellCenter(anchor.cell);
    const sx = from.x - c.x;
    const sy = from.y - c.y;
    const len = Math.hypot(sx, sy);
    const occupied: { x: number; y: number }[] = [];
    for (const p of peers) {
      const at = sprayPointOf(p);
      if (p.cell === null || at === null) continue;
      const pc = cellCenter(p.cell);
      if (Math.hypot(pc.x - c.x, pc.y - c.y) <= gameLineCellRadiusM()) occupied.push(at);
    }
    return { anchorCell: anchor.cell, side: { x: sx / len, y: sy / len }, occupied, anchorSpraying: anchor.spraying };
  }

  /** Whether this crew's own hose plan already sits on `line` (same front, same side). */
  private onLine(plan: MissionPlanT, line: ContainmentLine): boolean {
    if (plan.work?.kind !== "suppress_fire") return false;
    const a = cellCenter(line.anchorCell);
    const mine = cellCenter(plan.work.gridCellIndex);
    if (Math.hypot(a.x - mine.x, a.y - mine.y) > gameLineCellRadiusM()) return false;
    const standoff = planStandoffPoint(this.road, plan);
    if (standoff === null) return false;
    const dx = standoff.x - mine.x;
    const dy = standoff.y - mine.y;
    const len = Math.hypot(dx, dy);
    return len >= 1 && (dx * line.side.x + dy * line.side.y) / len >= GAME_CHANGES.lineSameSideMinDot;
  }

  /** A crew fighting fire near another crew's line regroups onto it instead of working alone. */
  private maybeJoinLine(proj: AgentProjection, ctx: PlanningContext, out: TickOutput): boolean {
    const active = this.active;
    if (!this.gameChanges || active === null || active.kind !== "mission" || this.objective !== null || this.holding) return false;
    if (active.plan.work?.kind !== "suppress_fire") return false;
    const now = proj.simTimeMs;
    if (now - this.lastSwitchMs < this.cfg.switchCooldownMs) return false;
    const line = this.lineToJoin(proj.position);
    if (line === null || this.onLine(active.plan, line)) return false;
    this.lastSwitchMs = now;
    const result = this.candidateSearch(ctx, null);
    const remainingApproachMs = proj.commitment?.working === true ? 0 : Math.max(0, active.plan.workInterval.startMs - now);
    const joined = result.candidates.filter(
      (c) => this.onLine(c.plan, line) && c.approachMs <= remainingApproachMs + GAME_CHANGES.lineMaxDetourMs,
    );
    if (joined.length === 0) return false;
    const chosen = this.commitFirst(proj, { ...result, best: joined[0]!, candidates: joined, plan: joined[0]!.plan }, out);
    if (chosen === null) return false;
    this.decide(out, proj, "mission_update", "brigade_line", `joining the nearby crew's hose line to ${this.missionVerb(chosen.target.id)}`);
    this.report(out, explain(this.callsign, { type: "mission_update", reasonCode: "brigade_line", actualAction: `joining the hose line to ${this.missionVerb(chosen.target.id)}` }), false);
    return true;
  }

  /** True when known burning fire lies within a cell of the next stretch of this crew's off-road drive. */
  private offroadPathThreatened(proj: AgentProjection): boolean {
    const position = proj.position;
    if (position.kind !== "offroad" || this.active === null || scheduledLegCount(this.active.plan) === 0) return false;
    const here = this.pointOf(position);
    const dx = position.end.x - here.x;
    const dy = position.end.y - here.y;
    const remaining = Math.hypot(dx, dy);
    if (remaining < 1) return false;
    const look = Math.min(remaining, 2 * SIM_DEFAULTS.cellMeters);
    const ahead = { x: here.x + (dx / remaining) * look, y: here.y + (dy / remaining) * look };
    const burning = new Set(this.evidence.knownBurningCells(proj.simTimeMs));
    return pathClearanceM(burning, here, ahead) < SIM_DEFAULTS.cellMeters;
  }

  private pointOf(position: AgentPosition): { x: number; y: number } {
    if (position.kind === "node") return this.road.nodePoint(position.nodeId);
    if (position.kind === "offroad") {
      return {
        x: position.start.x + (position.end.x - position.start.x) * position.progress,
        y: position.start.y + (position.end.y - position.start.y) * position.progress,
      };
    }
    return this.road.pointAlong(this.road.mustEdge(position.edgeId), position.distanceAlongPolyline);
  }

  /**
   * Game-changes brigade: when another crew holds the same burning cell and this crew knows of
   * other burning cells, the higher-id crew moves to open fire (even mid-hose). With a single
   * known cell there is only one option, so crews stay together.
   */
  private maybeSplitFromPeer(proj: AgentProjection, ctx: PlanningContext, out: TickOutput): boolean {
    const active = this.active;
    const picture = this.lastEnv.brigadePeer;
    if (!this.gameChanges || active === null || active.kind !== "mission" || this.objective !== null || picture === undefined) return false;
    const work = active.plan.work;
    if (work?.kind !== "suppress_fire") return false;
    // Sharing a cell from the same side is a hose line, not a collision.
    const line = this.lineToJoin(proj.position);
    if (line !== null && this.onLine(active.plan, line)) return false;
    if (!shouldYieldCell(this.agentId, picture.holdersOf(work.gridCellIndex))) return false;
    const now = proj.simTimeMs;
    if (now - this.lastSwitchMs < this.cfg.switchCooldownMs) return false;
    const burning = this.burnCellsForPlanning(now);
    if (!shouldSplitBrigadeLine(burning.length, GAME_CHANGES.brigadeSplitMinBurnCells)) return false;
    const result = this.candidateSearch(ctx, null);
    const open = result.candidates.filter((c) => {
      const cell = c.target.gridCellIndex;
      return c.target.kind !== "contain" || (cell !== undefined && cell !== work.gridCellIndex && !picture.suppressCells.has(cell));
    });
    if (open.length === 0) return false;
    const chosen = this.commitFirst(proj, { ...result, best: open[0]!, candidates: open, plan: open[0]!.plan }, out);
    if (chosen === null) return false;
    this.lastSwitchMs = now;
    this.decide(out, proj, "mission_update", "brigade_split", `splitting from the crew on the same fire to ${this.missionVerb(chosen.target.id)}`);
    this.report(out, explain(this.callsign, { type: "mission_update", reasonCode: "brigade_split", actualAction: this.missionVerb(chosen.target.id) }), false);
    return true;
  }

  /** The autonomy policy's verdict on carrying on with the committed plan. */
  private continuation(active: ActivePlan, proj: AgentProjection, ctx: PlanningContext, routeBlocked: boolean, certifyFailure: string | null) {
    const fireFirst = this.commitsFireFirst(active.plan);
    return decideContinuation(this.callsign, {
      phase: this.phaseOf(active, proj),
      mode: active.mode,
      routeBlocked,
      certifyFailure: fireFirst && certifyFailure?.startsWith("forecast_") ? null : certifyFailure,
      forecastReliable: fireFirst || ctx.ensemble.reliability !== "unreliable",
    });
  }

  /** Game-changes: suppress / toward-fire plans ignore forecast margin; observed fire still blocks. */
  private commitsFireFirst(plan: MissionPlanT): boolean {
    if (!this.gameChanges) return false;
    if (plan.work?.kind === "suppress_fire") return true;
    if (this.objective?.kind === "move_direction" || this.objective?.kind === "contain_fire") return true;
    const targetId = this.active?.plan.id === plan.id ? this.active.targetId : null;
    return targetId !== null && isExploreTargetId(targetId);
  }

  private withdrawPer(verdict: ReturnType<CrewController["continuation"]>, proj: AgentProjection, ctx: PlanningContext, out: TickOutput): void {
    if (verdict.action === "withdraw") this.withdraw(verdict.reason, proj, ctx, out);
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
      this.decide(out, proj, "withdrawal_triggered", reason, `withdrawing to ${this.nodeName(ret.refugeNodeId)}`);
      this.report(out, explain(this.callsign, { type: "withdrawal_triggered", reasonCode: reason, actualAction: "" }), true);
      return;
    }
    this.retreatOrStrand(reason, proj, ctx, out);
  }

  private returnNow(reason: string, proj: AgentProjection, ctx0: PlanningContext, out: TickOutput): void {
    const ctx = this.asClass(ctx0, "return");
    const ret = planReturn(ctx);
    if (ret !== null && this.commit(proj, ret.plan, "normal", "return", null, null, 0, out)) {
      this.decide(out, proj, "mission_update", reason, `returning to ${this.nodeName(ret.refugeNodeId)}`);
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
      this.decide(out, proj, "withdrawal_triggered", reason, `withdrawing to ${this.nodeName(ret.refugeNodeId)}`);
      return;
    }
    this.retreatOrStrand(reason, proj, ctx, out);
  }

  private retreatOrStrand(reason: string, proj: AgentProjection, ctx: PlanningContext, out: TickOutput): void {
    if (this.gameChanges && proj.position.kind === "offroad" && this.tryRejoinRoad(proj, ctx, out)) {
      this.stranded = false;
      return;
    }
    const retreat = planRetreat(ctx);
    if (retreat !== null) {
      this.stranded = false;
      this.commit(proj, retreat.plan, "retreating", "emergency", null, null, 0, out);
      this.decide(out, proj, "retreat_triggered", "no_normal_return", `retreating to ${this.nodeName(retreat.refugeNodeId)} (best effort)`);
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
    const refuge =
      this.map.refuges[0]?.nodeId ??
      (proj.position.kind === "node"
        ? proj.position.nodeId
        : proj.position.kind === "edge"
          ? proj.position.edgeId
          : NodeId.parse("offroad-halt"));
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

  /** Burning cells this crew will plan suppression for (observed plus forecast hints in game-changes). */
  private burnCellsForPlanning(simTimeMs: number): readonly number[] {
    const observed = this.evidence.knownBurningCells(simTimeMs);
    if (observed.length > 0) return observed;
    if (!this.gameChanges || !GAME_CHANGES.useBriefingFireCells) return observed;
    // After the crew has seen fire once, stop chasing briefing ignition that may already be out.
    if (this.evidence.supportingObservationIds().length > 0) return observed;
    return mergeBurnCellLists(observed, this.evidence.briefingFireCells(simTimeMs));
  }

  /** Containment targets on the line's fire front. */
  private lineFront(targets: readonly MissionTarget[], line: ContainmentLine): MissionTarget[] {
    const anchor = cellCenter(line.anchorCell);
    return targets.filter((t) => {
      if (t.gridCellIndex === undefined) return false;
      const c = cellCenter(t.gridCellIndex);
      return Math.hypot(c.x - anchor.x, c.y - anchor.y) <= gameLineCellRadiusM();
    });
  }

  private lineWorthDetour(onLine: MissionSearchResult, alone: MissionSearchResult): boolean {
    if (onLine.best === null) return false;
    if (alone.best === null) return true;
    return onLine.best.approachMs <= alone.best.approachMs + GAME_CHANGES.lineMaxDetourMs;
  }

  /** Burning cells this crew may plan against: its own evidence plus fire it can see a nearby crew hosing. */
  private fireCellsKnownTo(position: AgentPosition, nowMs: number): readonly number[] {
    const known = this.burnCellsForPlanning(nowMs);
    const line = this.lineToJoin(position);
    if (line === null || !line.anchorSpraying || known.includes(line.anchorCell) || this.evidence.seenNotBurning(line.anchorCell)) {
      return known;
    }
    return [...known, line.anchorCell];
  }

  /** Sites that need structure work under game-changes (fire at the building or known damage). */
  private threatenedSiteFilter(nowMs: number): ReadonlySet<string> | null {
    if (!this.gameChanges || !GAME_CHANGES.protectSitesOnlyWhenThreatened) return null;
    const burning = new Set(this.burnCellsForPlanning(nowMs));
    const ids = new Set<string>();
    for (const site of this.map.sites) {
      if (this.evidence.siteNeedsProtection(site.id)) {
        ids.add(site.id);
        continue;
      }
      const p = this.road.nodePoint(site.nodeId);
      const exposure = cellsWithin(p.x, p.y, SIM_DEFAULTS.siteExposureRadiusM);
      if (exposure.some((c) => burning.has(c) || this.evidence.closed.has(c))) ids.add(site.id);
    }
    return ids;
  }

  candidateSearch(
    ctx: PlanningContext,
    allowedSites: ReadonlySet<string> | null,
    containCellIndex?: number,
  ): MissionSearchResult {
    const rate = this.cfg.nav?.crewWorkRate ?? this.capabilities.workRate;
    const nav = this.cfg.nav;
    const line = this.lineToJoin(ctx.position);
    const burning = this.fireCellsKnownTo(ctx.position, ctx.nowMs);
    const siteThreatened = this.threatenedSiteFilter(ctx.nowMs);
    let siteAllowed = allowedSites;
    if (siteThreatened !== null) {
      if (siteAllowed !== null) {
        siteAllowed = new Set([...siteAllowed].filter((id) => siteThreatened.has(id)));
      } else {
        siteAllowed = siteThreatened;
      }
    }
    const peer = ctx.brigadePeer?.suppressCells ?? ctx.peerSuppressCells ?? new Set<number>();
    const siteTargetsAll = protectionTargets(this.evidence.siteKnowledge(), rate, siteAllowed).map((t) => {
      if (!this.gameChanges || siteThreatened === null || !siteThreatened.has(t.id)) return t;
      const boosted = Math.max(t.value, GAME_CHANGES.siteThreatMissionValue);
      return boosted === t.value ? t : { ...t, value: boosted };
    });
    const splitLine =
      this.gameChanges &&
      shouldSplitBrigadeLine(burning.length, GAME_CHANGES.brigadeSplitMinBurnCells);
    let cellTargets = containmentTargets(
      burning,
      this.road,
      rate,
      nav,
      this.gameChanges,
      (splitLine || line !== null) && ctx.brigadePeer !== undefined
        ? {
            agentId: this.agentId,
            peerCountOnCell: ctx.brigadePeer.peerCountOnCell,
            peerStandoffNodes: ctx.brigadePeer.standoffNodes,
            ...(line === null ? {} : { line }),
          }
        : undefined,
    );
    if (allowedSites !== null) cellTargets = [];
    if (containCellIndex !== undefined) {
      cellTargets = cellTargets.filter((t) => t.gridCellIndex === containCellIndex);
      return planMissions(ctx, cellTargets);
    }
    const front = line === null ? [] : this.lineFront(cellTargets, line);
    // Join the line when it is not a long detour from the best fire this crew could reach alone.
    const joinLine =
      front.length > 0 &&
      (front.length === cellTargets.length || this.lineWorthDetour(planMissions(ctx, front), planMissions(ctx, cellTargets)));
    if (joinLine) {
      cellTargets = front;
    } else if (splitLine && cellTargets.length > 0) {
      const openLine = cellTargets.filter((t) => t.gridCellIndex === undefined || !peer.has(t.gridCellIndex));
      if (openLine.length > 0) cellTargets = openLine;
    }
    const threatenedCount = siteThreatened?.size ?? 0;
    if (this.gameChanges && threatenedCount > 0 && siteTargetsAll.length > 0 && allowedSites === null) {
      const siteResult = planMissions(ctx, siteTargetsAll);
      const preferSite = preferSiteWhenThreatened(
        this.agentId,
        peer,
        threatenedCount,
        burning.length,
        GAME_CHANGES.brigadeSplitMinBurnCells,
      );
      if (preferSite && siteResult.best !== null) return siteResult;
      if (cellTargets.length > 0) {
        const fireResult = planMissions(ctx, cellTargets);
        if (fireResult.best !== null) return fireResult;
      }
      if (siteResult.best !== null) return siteResult;
    }
    if (this.gameChanges && cellTargets.length > 0 && allowedSites === null) {
      const fireFirst = planMissions(ctx, cellTargets);
      if (fireFirst.best !== null) return fireFirst;
    }
    if (this.gameChanges && burning.length === 0 && siteTargetsAll.length === 0) {
      return { feasible: false, best: null, candidates: [], plan: null, limitingReason: "no_unresolved_target", limitingMemberIds: [] };
    }
    return planMissions(ctx, [...siteTargetsAll, ...cellTargets]);
  }

  private chooseWhenIdle(proj: AgentProjection, ctx: PlanningContext, out: TickOutput): void {
    const now = proj.simTimeMs;
    const dirty = this.evalDirty || now - this.lastEvalMs >= this.cfg.reassessEveryMs;
    if (!dirty) return;

    if (this.gameChanges) {
      this.evalDirty = false;
      this.lastEvalMs = now;
      // A coordinator hold is the one deliberate pause; otherwise a crew always fights fire or explores.
      if (!this.holding) this.seekWork(proj, ctx, out);
      return;
    }

    if (!this.atRefuge(proj.position)) {
      this.evalDirty = false;
      this.lastEvalMs = now;
      this.withdraw(this.stranded ? "no_known_passable_route" : "forecast_wait_unsafe", proj, ctx, out);
      return;
    }
    if (this.stranded) {
      this.evalDirty = false;
      this.lastEvalMs = now;
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

    const allowed =
      this.objective?.kind === "protect_site" && this.objective.targetId !== null ? new Set([this.objective.targetId]) : null;
    const containCell = objectiveContainCell(this.objective);
    if (!admitsProtection(ctx.ensemble)) {
      this.noteIdle(proj, "forecast_unreliable", out);
      return;
    }
    const line = this.objective?.kind === "build_line" ? this.lineSearch(ctx, this.objective) : null;
    const result = line !== null && typeof line !== "string" ? line : this.candidateSearch(ctx, allowed, containCell);
    const chosen = result.best !== null ? this.commitFirst(proj, result, out) : null;
    if (chosen !== null) {
      this.lastIdleReason = null;
      const t = chosen.target;
      this.decide(out, proj, "mission_start", "mission_admitted", `${this.missionVerb(t.id)} (work ${Math.round(chosen.workMs / 1000)} s, return to ${this.nodeName(chosen.refugeNodeId)})`);
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

  /**
   * Game-changes: the crew is never idle. Fight known fire (splitting along the line when there
   * is more than one cell), else protect threatened buildings, else explore, else get back on the
   * road network so the next search can start.
   */
  private seekWork(proj: AgentProjection, ctx: PlanningContext, out: TickOutput): void {
    if (proj.position.kind === "offroad") {
      if (this.tryHoseInPlace(proj, ctx, out)) return;
      if (this.tryRejoinRoad(proj, ctx, out)) return;
      this.noteIdle(proj, "no_known_passable_route", out);
      return;
    }
    const now = proj.simTimeMs;
    const allowed =
      this.objective?.kind === "protect_site" && this.objective.targetId !== null ? new Set([this.objective.targetId]) : null;
    const containCell = objectiveContainCell(this.objective);
    const burning = this.burnCellsForPlanning(now);
    const result: MissionSearchResult | null =
      admitsProtection(ctx.ensemble) || burning.length > 0 ? this.candidateSearch(ctx, allowed, containCell) : null;
    const chosen = result !== null && result.best !== null ? this.commitFirst(proj, result, out) : null;
    if (chosen !== null) {
      this.stranded = false;
      this.lastIdleReason = null;
      const t = chosen.target;
      this.decide(out, proj, "mission_start", "mission_admitted", `${this.missionVerb(t.id)} (work ${Math.round(chosen.workMs / 1000)} s, return to ${this.nodeName(chosen.refugeNodeId)})`);
      this.report(out, explain(this.callsign, { type: "mission_start", reasonCode: "mission_admitted", actualAction: this.missionVerb(t.id) }), false);
      return;
    }
    if ((allowed !== null || containCell !== undefined) && this.objective !== null) {
      const reason = result?.limitingReason ?? "forecast_unreliable";
      this.decide(out, proj, "objective_rejected", reason, `objective ${this.objective.id} cannot be satisfied`);
      this.report(out, explain(this.callsign, { type: "objective_rejected", reasonCode: reason, actualAction: "" }, `(${reason})`), true);
      this.objective = null;
      this.evalDirty = true;
      return;
    }
    if (this.tryPatrolExplore(proj, ctx, out)) {
      this.stranded = false;
      return;
    }
    if (!this.stranded && !this.atRefuge(proj.position)) {
      this.returnNow(result?.limitingReason ?? "no_unresolved_target", proj, ctx, out);
      return;
    }
    this.noteIdle(proj, result?.limitingReason ?? "no_feasible_mission_in_model", out);
  }

  /** Off-road beside fire: keep hosing from here, on the nearby crew's line front when there is one. */
  private tryHoseInPlace(proj: AgentProjection, ctx: PlanningContext, out: TickOutput): boolean {
    const line = this.lineToJoin(proj.position);
    const burning = this.fireCellsKnownTo(proj.position, proj.simTimeMs);
    if (burning.length === 0) return false;
    const rate = this.cfg.nav?.crewWorkRate ?? this.capabilities.workRate;
    const targets = containmentTargets(burning, this.road, rate, this.cfg.nav, true);
    const front = line === null ? [] : this.lineFront(targets, line);
    const result = planHoseInPlace(ctx, front.length > 0 ? front : targets);
    const chosen = result.best;
    if (chosen === null) return false;
    if (!this.commit(proj, chosen.plan, "normal", "mission", chosen.target.id, null, chosen.score, out)) return false;
    this.stranded = false;
    this.lastIdleReason = null;
    this.decide(out, proj, "mission_start", "hose_in_place", `hosing ${this.missionVerb(chosen.target.id)} from where the crew stands`);
    return true;
  }

  private tryRejoinRoad(proj: AgentProjection, ctx: PlanningContext, out: TickOutput): boolean {
    // Burned-out ground is passable; only fire still known to be burning blocks the drive back.
    const result = planRejoinRoad({ ...ctx, closedCells: new Set(this.evidence.knownBurningCells(proj.simTimeMs)) });
    if (result.best === null) return false;
    const chosen = this.commitFirst(proj, result, out);
    if (chosen === null) return false;
    this.lastIdleReason = null;
    const node = this.nodeName(chosen.refugeNodeId);
    this.decide(out, proj, "mission_start", "rejoin_road", `driving back to the road at ${node}`);
    return true;
  }

  /** Road-first patrol that rotates heading each round and avoids nodes this crew already visited. */
  private tryPatrolExplore(proj: AgentProjection, ctx: PlanningContext, out: TickOutput): boolean {
    if (!this.gameChanges || !GAME_CHANGES.patrolWhenNoFireKnown) return false;
    if (proj.position.kind === "offroad") return false;
    if (proj.position.kind === "node") this.patrolledNodes.add(proj.position.nodeId);
    const directions = patrolDirectionsForAgent(this.agentId, this.patrolRound);
    const attempt = (skipVisited: boolean): { chosen: RankedMissionT; direction: CompassDirection } | null => {
      for (const direction of directions) {
        const movement = { direction, maxDistanceMeters: GAME_CHANGES.patrolMaxDistanceM, stopRule: "safe_road_node" as const };
        const targets = directionalTargets(ctx, movement).filter((t) => !skipVisited || !this.patrolledNodes.has(t.nodeId));
        if (targets.length === 0) continue;
        const result = planMissions(ctx, targets);
        if (result.best === null) continue;
        const chosen = this.commitFirst(proj, result, out);
        if (chosen !== null) return { chosen, direction };
      }
      return null;
    };
    let picked = attempt(true);
    if (picked === null && this.patrolledNodes.size > 0) {
      // The reachable map is explored: start a fresh sweep rather than stopping.
      this.patrolledNodes.clear();
      picked = attempt(false);
    }
    if (picked === null) {
      for (const direction of directions) {
        const movement = { direction, maxDistanceMeters: GAME_CHANGES.patrolMaxDistanceM, stopRule: "safe_road_node" as const };
        const result = planDirectionalMove(ctx, movement);
        if (result.best === null) continue;
        const chosen = this.commitFirst(proj, result, out);
        if (chosen !== null) {
          picked = { chosen, direction };
          break;
        }
      }
    }
    if (picked === null) return false;
    const { chosen } = picked;
    this.patrolledNodes.add(chosen.target.nodeId);
    this.patrolRound++;
    this.lastIdleReason = null;
    const dir = picked.direction;
    this.decide(
      out,
      proj,
      "mission_start",
      "patrol_for_fire",
      `patrolling ${dir} to locate fire (work ${Math.round(chosen.workMs / 1000)} s, return to ${this.nodeName(chosen.refugeNodeId)})`,
    );
    this.report(
      out,
      explain(this.callsign, { type: "mission_start", reasonCode: "patrol_for_fire", actualAction: `patrolling ${dir}` }),
      false,
    );
    return true;
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
    const burning = this.burnCellsForPlanning(proj.simTimeMs);
    const activeIsContain = active.targetId?.startsWith("cell-") ?? false;
    if (this.gameChanges && burning.length > 0 && activeIsContain && best.target.kind !== "contain") {
      const threatened = this.threatenedSiteFilter(proj.simTimeMs);
      const siteId = best.target.siteId;
      if (threatened === null || threatened.size === 0 || best.target.kind !== "protect" || siteId === null || !threatened.has(siteId)) {
        return;
      }
    }
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
      case "move_direction": {
        if (obj.movement === undefined) return reject("missing_direction");
        const result = planDirectionalMove(ctx, obj.movement);
        if (result.best === null) return reject(result.limitingReason ?? "no_safe_directional_route");
        const hadPlan = this.active !== null;
        const chosen = this.commitFirst(proj, result, out);
        if (chosen === null) return reject("reservation_unavailable");
        this.objective = obj;
        this.holding = false;
        const viaOffroad = chosen.plan.offroadLegs !== undefined && chosen.plan.timedLegs.length === 0;
        this.decide(
          out,
          proj,
          hadPlan ? "mission_update" : "mission_start",
          "objective_accepted",
          viaOffroad
            ? `moving ${obj.movement.direction} off-road toward the fire line`
            : `moving ${obj.movement.direction} to a safe road node, then returning to refuge`,
        );
        return;
      }
      case "protect_site": {
        if (obj.targetId === null) return reject("missing_target");
        const sites = this.evidence.siteKnowledge();
        const site = sites.find((s) => s.siteId === obj.targetId);
        if (site === undefined) return reject("unknown_site");
        if (site.knownResolved) return reject("target_resolved");
        const result = this.candidateSearch(ctx, new Set([obj.targetId]));
        const verdict = decideOrder(this.callsign, {
          kind: obj.kind,
          forecastReliable: this.gameChanges || ctx.ensemble.reliability !== "unreliable",
          feasible: result.best !== null,
          limitingReason: result.limitingReason,
        });
        if (verdict.action === "refuse") return reject(verdict.reason);
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
      case "contain_fire": {
        const cell = objectiveContainCell(obj);
        if (cell === undefined) return reject("missing_target");
        const result = this.candidateSearch(ctx, null, cell);
        const verdict = decideOrder(this.callsign, {
          kind: obj.kind,
          forecastReliable: this.gameChanges || ctx.ensemble.reliability !== "unreliable",
          feasible: result.best !== null,
          limitingReason: result.limitingReason,
        });
        if (verdict.action === "refuse") return reject(verdict.reason);
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
      case "build_line": {
        const result = this.lineSearch(ctx, obj);
        if (result === null) return reject("missing_target");
        if (typeof result === "string") return reject(result);
        const verdict = decideOrder(this.callsign, {
          kind: obj.kind,
          forecastReliable: ctx.ensemble.reliability !== "unreliable",
          feasible: result.best !== null,
          limitingReason: result.limitingReason,
        });
        if (verdict.action === "refuse") return reject(verdict.reason);
        const hadPlan = this.active !== null;
        this.objective = obj;
        this.holding = false;
        const chosen = this.commitFirst(proj, result, out);
        if (chosen === null) {
          this.objective = null;
          return reject("reservation_unavailable");
        }
        this.decide(out, proj, hadPlan ? "mission_update" : "mission_start", "objective_accepted", `${this.missionVerb(chosen.target.id)} on coordinator objective (work ${Math.round(chosen.workMs / 1000)} s)`);
        this.report(out, explain(this.callsign, { type: "mission_start", reasonCode: "objective_accepted", actualAction: this.missionVerb(chosen.target.id) }), false);
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
        this.decide(out, proj, "mission_update", "objective_accepted", `returning to ${this.nodeName(ret.refugeNodeId)} on coordinator objective`);
        return;
      }
      default:
        return reject("objective_not_supported");
    }
  }

  // ---------- helpers ----------

  protected missionVerb(id: string): string {
    if (id.startsWith("cell-")) return `containing fire near ${id.slice(5)}`;
    const line = id.startsWith("line:") ? this.objective?.constraints.line : undefined;
    if (line !== undefined) return `cutting ${this.lineWords(line)}`;
    return `heading to ${this.siteName(id)}`;
  }

  /**
   * Missions for one fire-line objective: null when it names no line, or the refusal reason when the
   * crew's end has no road in reach. A line order wants the longest shift the forecast admits, not the
   * best work-per-second ratio.
   */
  private lineSearch(ctx: PlanningContext, obj: Objective): MissionSearchResult | FirelineRefusal | null {
    const line = obj.constraints.line;
    if (line === undefined) return null;
    const planned = firelineTarget(this.road, line.start, line.end, this.capabilities.workRate, this.cfg.nav ?? DEFAULT_NAV_CONFIG);
    if (!planned.ok) return planned.reason;
    const result = planMissions(ctx, [planned.target]);
    const candidates = [...result.candidates].sort((a, b) => b.workMs - a.workMs || b.score - a.score);
    return { ...result, candidates, best: candidates[0] ?? null };
  }

  /** "line from the north end toward East Junction": the crew's end by compass, the far end by place. */
  private lineWords(line: { start: MapPoint; end: MapPoint }): string {
    const words = lineEndWords(line.start, line.end, this.namedPlaceNear(line.end, NAMED_PLACE_REACH_M));
    return `line from ${words.own} toward ${words.far}`;
  }

  /** Name of the nearest named place (refuge, site, named junction) within `withinM` of a point, if any. */
  private namedPlaceNear(p: MapPoint, withinM: number): string | null {
    let best: string | null = null;
    let bestDist = withinM;
    for (const id of this.road.nodes.keys()) {
      const name = this.placeName(id);
      if (name === null) continue;
      const q = this.road.nodePoint(id);
      const d = Math.hypot(q.x - p.x, q.y - p.y);
      if (d <= bestDist) {
        best = name;
        bestDist = d;
      }
    }
    return best;
  }

  /** Player-facing name for a map node: refuge or site; the raw id is never shown. */
  protected nodeName(nodeId: string): string {
    return this.placeName(nodeId) ?? "a waypoint";
  }

  /** The name of a refuge, site or named junction at a node, or null for an unnamed node. */
  protected placeName(nodeId: string): string | null {
    const refuge = this.map.refuges.find((r) => r.nodeId === nodeId);
    if (refuge !== undefined) return refuge.name;
    const site = this.map.sites.find((x) => x.nodeId === nodeId);
    if (site !== undefined) return site.name;
    return this.map.nodes.find((n) => n.id === nodeId)?.name ?? null;
  }

  protected siteName(id: string): string {
    return this.map.sites.find((s) => s.id === id)?.name ?? id;
  }

  protected classOfActive(): PriorityClass {
    const a = this.active;
    if (a !== null && a.mode !== "normal") return "emergency";
    if (a !== null && a.kind === "return") return "return";
    return "approach";
  }

  private classFor(mode: "normal" | "withdrawing" | "retreating", kind: PlanKind): PriorityClass {
    if (mode !== "normal") return "emergency";
    if (kind === "return") return "return";
    return "approach";
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
    const peer = this.lastEnv.peerSuppressCells ?? new Set<number>();
    const burning = this.fireCellsKnownTo(proj.position, proj.simTimeMs);
    const pool =
      this.gameChanges &&
      burning.length >= GAME_CHANGES.brigadeSplitMinBurnCells &&
      result.candidates.some((c) => c.target.kind === "contain")
        ? rankContainmentCandidates(this.agentId, result.candidates, burning, peer)
        : [...result.candidates];
    for (const cand of pool.slice(0, 20)) {
      const t = cand.target;
      if (t.kind === "contain") {
        const ens = this.forecast.current;
        if (t.gridCellIndex === undefined || ens === null || !burning.includes(t.gridCellIndex)) {
          continue;
        }
        if (cand.approachMs === 0 && (proj.position.kind !== "node" || proj.position.nodeId !== t.nodeId)) continue;
      }
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
    const styled = applyStyle(this.callsign, text, this.style);
    this.lastReportText = styled;
    const entry: CoordinatorReport = { text: styled, urgent };
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
    const targetName =
      a?.targetId == null
        ? null
        : a.targetId.startsWith("waypoint:")
          ? "road waypoint"
          : a.targetId.startsWith("line:")
            ? "fire line"
            : this.siteName(a.targetId);
    return {
      callsign: this.callsign,
      currentAction: verbs[this.computeState(proj)] === null ? null : `${verbs[this.computeState(proj)]}${targetName !== null && this.computeState(proj) !== "HOLDING" ? ` (${targetName})` : ""}`,
      objective: this.objectiveText(),
      returnEstimateSec: last === undefined || last === null ? null : Math.max(0, (last.arriveMs - proj.simTimeMs) / 1000),
      lastRejection: this.lastRejectionText,
      knownConditions: this.evidence.closed.size === 0 ? null : `${this.evidence.closed.size} cells observed burning or burned`,
      lastReport: this.lastReportText,
    };
  }

  private objectiveText(): string | null {
    const o = this.objective;
    if (o === null) return null;
    if (o.kind === "move_direction" && o.movement !== undefined) return `move ${o.movement.direction} up to ${o.movement.maxDistanceMeters} m`;
    if (o.kind === "build_line" && o.constraints.line !== undefined) {
      return `cut ${this.lineWords(o.constraints.line)}`;
    }
    return `${o.kind.replaceAll("_", " ")}${o.targetId === null ? "" : ` ${this.siteName(o.targetId)}`}`;
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

function objectiveContainCell(obj: Objective | null): number | undefined {
  if (obj === null || obj.kind !== "contain_fire") return undefined;
  if (obj.constraints.gridCellIndex !== undefined) return obj.constraints.gridCellIndex;
  if (obj.targetId === null || obj.targetId === "") return undefined;
  const parsed = Number.parseInt(obj.targetId, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

type JoinableLine = ContainmentLine & {
  /** The anchor crew is visibly spraying, so the joiner can treat its cell as seen fire. */
  readonly anchorSpraying: boolean;
};

/** Where a crew hosing fire sprays from: its own position once on scene, else its planned standoff. */
function sprayPointOf(peer: BrigadePeer): { x: number; y: number } | null {
  if (peer.cell === null) return null;
  const c = cellCenter(peer.cell);
  const onScene = peer.point !== null && Math.hypot(peer.point.x - c.x, peer.point.y - c.y) <= gameHoseRadiusM();
  const order = onScene ? [peer.point, peer.standoff] : [peer.standoff, peer.point];
  return order.find((p): p is { x: number; y: number } => p !== null && Math.hypot(p.x - c.x, p.y - c.y) >= 1) ?? null;
}

/** Patrol and road-rejoin plans; like fire missions they certify against observed fire only. */
function isExploreTargetId(targetId: string): boolean {
  return targetId.startsWith("waypoint:") || targetId.startsWith("offroad") || targetId.startsWith("rejoin:");
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
