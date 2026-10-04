import type { AgentId, AgentPosition, AgentState, EdgeId, MapPoint, MissionPlan, NodeId, SiteId } from "@ember/domain";
import { EdgePosition, Meters, OffroadPosition, SimTimeMs, approachLegCount, scheduledLegCount, scheduledLegs } from "@ember/domain";
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
  firelineCells,
  firelineId,
  mapFirebreakCells,
  reachableFirelineCells,
  refugeCells,
  streamRng,
  offRoadSegmentTraversable,
  GAME_CHANGES,
  gameCollaborationBonus,
  gameContainmentWorkRequired,
  gameLineApproachMaxM,
  gameLineCutReachM,
  gameHoseConeMinDot,
  gameHoseDangerRadiusM,
  gameHoseOnSceneRadiusM,
  gameHoseRadiusM,
  gameHoseStandoffTargetM,
  scenarioUsesGameChanges,
  turnToward,
  type FireParams,
  type RoadEdge,
} from "./model/index.js";
import { hoseCellInCone } from "./model/hose-cone.js";
import type { PlanMode } from "./inputs.js";
import type { AgentSpec, SimScenario } from "./scenario.js";
import { nearestNodeId } from "./planLegs.js";

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
  | { kind: "edge"; edgeId: EdgeId; dist: number; direction: "forward" | "reverse"; turnMs: number }
  | { kind: "offroad"; start: { x: number; y: number }; end: { x: number; y: number }; progress: number };

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
  /** Game-changes: the way the crew faces while fire is within hose reach (unit vector); null otherwise. */
  hoseAim: { x: number; y: number } | null;
  /** Game-changes: the crew's spray hit burning fire this step. */
  spraying: boolean;
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
  | { tick: number; kind: "plan_accepted"; agentId: AgentId; planId: string; mode: PlanMode; hasWork: boolean; legCount: number }
  | { tick: number; kind: "plan_rejected"; agentId: AgentId; reason: string }
  | { tick: number; kind: "plan_cancelled"; agentId: AgentId; planId: string; reason: string }
  | { tick: number; kind: "plan_complete"; agentId: AgentId; planId: string }
  | { tick: number; kind: "entry_blocked"; agentId: AgentId; edgeId: EdgeId }
  | { tick: number; kind: "plan_interrupted_by_end"; agentId: AgentId; planId: string }
  | { tick: number; kind: "agent_lost"; agentId: AgentId }
  | { tick: number; kind: "site_resolved"; siteId: SiteId; how: "protected" | "destroyed" }
  | { tick: number; kind: "edge_closed"; edgeId: EdgeId }
  | { tick: number; kind: "fireline_resolved"; lineId: string; outcome: "complete" | "breached" }
  | {
      tick: number;
      kind: "containment_completed";
      agentId: AgentId;
      gridCellIndex: number;
      outcome: "succeeded" | "failed";
      reasonCode: string;
    };

/** A fire line crews were sent to build; `cells` run from `from` to `to`. */
export interface TruthFireline {
  readonly id: string;
  /** Canonical order (lower end cell first), so the line does not depend on which crew registered it. */
  readonly start: MapPoint;
  readonly end: MapPoint;
  readonly cells: readonly number[];
  resolved: boolean;
}

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
  /** Pre-placed firebreak cells from the map. */
  private readonly mapFirebreaks: ReadonlySet<number>;
  /** Cells crews have cleared into firebreaks during the run. */
  readonly builtFirebreaks = new Set<number>();
  /** Fire lines by id, in the order crews were first sent to them. */
  readonly firelines = new Map<string, TruthFireline>();
  readonly notices: SimNotice[] = [];
  /** Scenario opt-in for hose reach, off-road directional halts, and full cell extinguish on containment. */
  readonly gameChanges: boolean;
  timeMs = 0;

  constructor(scenario: SimScenario, privateParams: PrivateWorldParameters) {
    this.gameChanges = scenarioUsesGameChanges(scenario);
    this.road = new RoadIndex(scenario.map);
    this.params = privateParams;
    this.mapFirebreaks = mapFirebreakCells(this.road);
    const terrain = createTerrain(scenario.map.terrainSeed);
    this.fire = new FireField(terrain, refugeCells(this.road, SIM_DEFAULTS.refugeRadiusM), this.mapFirebreaks);
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
        hoseAim: null,
        spraying: false,
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

  /** Every firebreak cell (pre-placed and built), sorted and unique. */
  firebreakCells(): number[] {
    return [...new Set([...this.mapFirebreaks, ...this.builtFirebreaks])].sort((a, b) => a - b);
  }

  agent(id: AgentId): TruthAgent {
    const found = this.agents.find((a) => a.id === id);
    if (found === undefined) throw new Error(`unknown agent ${id}`);
    return found;
  }

  agentPoint(agent: TruthAgent): { x: number; y: number } {
    if (agent.pos.kind === "node") return this.road.nodePoint(agent.pos.nodeId);
    if (agent.pos.kind === "offroad") {
      const p = agent.pos;
      return {
        x: p.start.x + (p.end.x - p.start.x) * p.progress,
        y: p.start.y + (p.end.y - p.start.y) * p.progress,
      };
    }
    return this.road.pointAlong(this.road.mustEdge(agent.pos.edgeId), agent.pos.dist);
  }

  siteResolved(site: TruthSite): boolean {
    return site.destroyed || site.completedWork >= site.requiredWork;
  }

  /** Fire touching the exposure ring or any accumulated structure damage. */
  siteThreatened(site: TruthSite): boolean {
    if (site.destroyed) return false;
    if (site.damage > 0) return true;
    return site.exposureCells.some((c) => this.fire.state[c] === CELL_BURNING);
  }

  /** Game-changes win: no active fire at buildings and nothing destroyed. */
  allSitesSecure(): boolean {
    return this.sites.every((s) => !s.destroyed && !this.siteThreatened(s));
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
    const schedule = scheduledLegs(plan);
    const hasWork = plan.workInterval.endMs > plan.workInterval.startMs;
    const approachCount = approachLegCount(plan);

    let cursor: NodeId | null = null;
    if (agent.pos.kind === "node") cursor = agent.pos.nodeId;
    let approachEndNode: NodeId | null = null;
    const near = (ax: number, ay: number, bx: number, by: number, tol = 2): boolean => Math.hypot(ax - bx, ay - by) <= tol;

    for (let i = 0; i < schedule.length; i++) {
      const entry = schedule[i];
      if (entry === undefined) continue;
      if (entry.kind === "offroad") {
        const leg = entry.leg;
        if (!offRoadSegmentTraversable(leg.start.x, leg.start.y, leg.end.x, leg.end.y)) return reject("offroad_not_traversable");
        const endNode = nearestNodeId(this.road, leg.end.x, leg.end.y);
        const suppress = plan.work?.kind === "suppress_fire" ? plan.work : undefined;
        const endsAtSuppressCell =
          suppress !== undefined && this.distanceToCellM(leg.end.x, leg.end.y, suppress.gridCellIndex) <= 2;
        const endsAtFieldHalt =
          this.gameChanges && !hasWork && suppress === undefined && offRoadSegmentTraversable(leg.start.x, leg.start.y, leg.end.x, leg.end.y);
        const endsAtLine = this.endsAtGameLine(plan, leg.end);
        if (endNode === null && !endsAtSuppressCell && !endsAtFieldHalt && !endsAtLine) return reject("offroad_end_not_at_node");
        if (i === 0) {
          const p = this.agentPoint(agent);
          if (!near(p.x, p.y, leg.start.x, leg.start.y)) return reject("offroad_not_connected");
        } else if (cursor !== null) {
          const startPt = this.road.nodePoint(cursor);
          if (!near(startPt.x, startPt.y, leg.start.x, leg.start.y)) return reject("offroad_not_connected");
        } else {
          return reject("offroad_not_connected");
        }
        if (endNode !== null) {
          cursor = endNode;
          if (i === approachCount - 1) approachEndNode = cursor;
        }
        continue;
      }
      const leg = entry.leg;
      const edge = this.road.edges.get(leg.edgeId);
      if (edge === undefined) return reject("unknown_edge");
      if (cursor === null) {
        if (i !== 0 || agent.pos.kind !== "edge" || agent.pos.edgeId !== leg.edgeId) return reject("leg_not_connected");
      } else {
        const start = leg.direction === "forward" ? edge.from : edge.to;
        if (start !== cursor) return reject("leg_not_connected");
      }
      cursor = leg.direction === "forward" ? edge.to : edge.from;
      if (i === approachCount - 1) approachEndNode = cursor;
      if (i === approachCount - 1 && hasWork && workSiteId !== null) {
        const site = this.sites.find((s) => s.id === workSiteId);
        if (site === undefined || site.nodeId !== cursor) return reject("work_site_not_at_approach_end");
      }
    }
    const suppress =
      plan.work?.kind === "suppress_fire" ? plan.work : undefined;
    if (suppress !== undefined && workSiteId !== null) return reject("containment_with_site_work");
    const line = plan.work?.kind === "build_line" ? plan.work : undefined;
    if (line !== undefined) {
      if (workSiteId !== null) return reject("fireline_with_site_work");
      if (!this.road.nodes.has(line.workNodeId)) return reject("fireline_unknown_node");
      if (line.start.x === line.end.x && line.start.y === line.end.y) return reject("fireline_needs_two_points");
      if (firelineCells(line.start, line.end).length === 0) return reject("fireline_off_map");
      // `start` is this crew's end of the line; its work node must be within reach of it (plan 2.5).
      // Game-changes crews drive off-road from that node and cut the line on foot from its end.
      const workPoint = this.road.nodePoint(line.workNodeId);
      const reachM = this.gameChanges ? gameLineApproachMaxM() : SIM_DEFAULTS.lineReachM;
      if (Math.hypot(workPoint.x - line.start.x, workPoint.y - line.start.y) > reachM) {
        return reject("fireline_end_out_of_reach");
      }
      if (hasWork && this.gameChanges) {
        const off = plan.offroadLegs ?? [];
        const lastOff = approachCount > 0 ? schedule[approachCount - 1] : undefined;
        const at =
          lastOff?.kind === "offroad"
            ? lastOff.leg.end
            : approachEndNode !== null
              ? this.road.nodePoint(approachEndNode)
              : approachCount === 0 && off.length === 0
                ? this.agentPoint(agent)
                : null;
        if (at === null || Math.hypot(at.x - line.start.x, at.y - line.start.y) > 2 * SIM_DEFAULTS.cellMeters) {
          return reject("fireline_work_not_at_line_end");
        }
      } else if (hasWork) {
        const endNode = approachEndNode ?? (agent.pos.kind === "node" && approachCount === 0 ? agent.pos.nodeId : null);
        if (endNode !== line.workNodeId) return reject("fireline_work_not_at_work_node");
      }
    }
    if (hasWork && workSiteId !== null) {
      const site = this.sites.find((s) => s.id === workSiteId);
      if (site === undefined) return reject("unknown_site");
      if (approachCount === 0 && !(agent.pos.kind === "node" && agent.pos.nodeId === site.nodeId)) {
        return reject("work_site_not_at_approach_end");
      }
    }
    if (hasWork && suppress !== undefined) {
      if (!this.canCommitSuppressWork(agent, suppress.gridCellIndex, plan, approachEndNode)) {
        return reject("containment_cell_unreachable");
      }
    }

    if (agent.pos.kind === "edge" && schedule.length > 0) {
      const first = schedule[0];
      if (first?.kind === "road" && first.leg.direction !== agent.pos.direction) {
        // Reversal keeps edge occupancy through the turnaround delay.
        agent.pos.direction = first.leg.direction;
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
    if (line !== undefined) this.registerFireline(line.start, line.end);
    agent.commitment = { plan, workSiteId, mode, legIndex: 0, approachCount, hasWork, blockedNoticed: false };
    agent.planRevision += 1;
    agent.working = false;
    this.notices.push({
      tick: this.timeMs,
      kind: "plan_accepted",
      agentId,
      planId: plan.id,
      mode,
      hasWork,
      legCount: scheduledLegCount(plan),
    });
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

    if (this.gameChanges && (this.suppressMission(agent) || this.cuttingGameLine(agent))) {
      this.applyFireStandoff(agent);
    }

    if (agent.pos.kind === "node" && c !== null) {
      this.advanceFromNode(agent, c, stepStartMs);
    }

    if (agent.pos.kind === "offroad") {
      const pos = agent.pos;
      const stepM = SIM_DEFAULTS.agentSpeedMps * (STEP / 1000);
      if (this.shouldHoldForSuppress(agent, c, stepStartMs)) {
        this.refreshGameSuppressWork(agent);
      } else if (this.isTacticalOffroad(agent) && pos.progress < 1 - 1e-9) {
        this.travelOffRoad(agent, pos, stepM);
      } else if (c !== null && pos.progress < 1 - 1e-9 && c.legIndex < scheduledLegCount(c.plan)) {
        const entry = scheduledLegs(c.plan)[c.legIndex];
        const factor = entry?.kind === "offroad" ? entry.leg.speedFactor : SIM_DEFAULTS.offRoadSpeedFactor;
        this.travelOffRoad(agent, pos, SIM_DEFAULTS.agentSpeedMps * factor * (STEP / 1000));
      }
    }

    if (c !== null && agent.pos.kind === "offroad" && agent.pos.progress >= 1 - 1e-9) {
      this.advanceFromNode(agent, c, stepStartMs);
    }

    if (agent.pos.kind === "edge") {
      const pos = agent.pos;
      if (pos.turnMs > 0) {
        pos.turnMs = Math.max(0, pos.turnMs - STEP);
      } else if (this.shouldHoldForSuppress(agent, c, stepStartMs)) {
        this.refreshGameSuppressWork(agent);
      } else if (this.gameChanges && this.suppressMission(agent)) {
        const ep = this.road.pointAlong(this.road.mustEdge(pos.edgeId), pos.dist);
        if (
          this.nearestBurningCellDistM(ep.x, ep.y) < gameHoseDangerRadiusM() &&
          this.crewCanHoseFrom(agent, ep.x, ep.y)
        ) {
          this.refreshGameSuppressWork(agent);
        } else if (agent.commitment !== null && agent.commitment.legIndex < scheduledLegCount(agent.commitment.plan)) {
          this.travel(agent, pos, SIM_DEFAULTS.agentSpeedMps * (STEP / 1000));
        }
      } else if (agent.commitment !== null && agent.commitment.legIndex < scheduledLegCount(agent.commitment.plan)) {
        // With no commitment, or one whose legs are exhausted (a halt), a mid-edge agent keeps
        // still: a forced emergency stop.
        this.travel(agent, pos, SIM_DEFAULTS.agentSpeedMps * (STEP / 1000));
      }
    }

    if (agent.pos.kind === "node" || agent.pos.kind === "offroad") {
      this.refreshGameSuppressWork(agent);
    }

    // Loss check covers the endpoint after movement; travel() checks the swept path.
    if (agent.state !== "lost") {
      const p = this.agentPoint(agent);
      if (this.isBurningAt(p.x, p.y) && !this.suppressHoseShields(agent)) this.lose(agent, stepEndMs);
    }
  }

  private suppressMission(agent: TruthAgent): boolean {
    return agent.commitment?.plan.work?.kind === "suppress_fire";
  }

  /** Active hosing: crew is fighting fire, not merely driving through it. */
  private suppressHoseShields(agent: TruthAgent): boolean {
    if (!this.gameChanges || !this.suppressMission(agent)) return false;
    if (agent.working) return true;
    const p = this.agentPointXY(agent);
    if (this.nearestBurningCellDistM(p.x, p.y) >= gameHoseDangerRadiusM()) return false;
    return this.crewCanHoseFrom(agent, p.x, p.y);
  }

  private shouldHoldForSuppress(agent: TruthAgent, c: Commitment | null, _stepStartMs: number): boolean {
    if (!this.gameChanges || c === null || agent.state === "lost") return false;
    if (c.plan.work?.kind !== "suppress_fire" || c.workSiteId !== null) return false;
    if (this.isTacticalOffroad(agent)) return false;
    const p = this.agentPointXY(agent);
    if (this.nearestBurningCellDistM(p.x, p.y) < gameHoseDangerRadiusM()) return false;
    if (!this.gameHoseSceneReady(agent, c)) return false;
    return this.crewCanHoseFrom(agent, p.x, p.y);
  }

  /** Game-changes: begin hose work only on scene after the approach (not from refuge at max reach). */
  private refreshGameSuppressWork(agent: TruthAgent): void {
    if (!this.gameChanges || agent.state === "lost") return;
    const c = agent.commitment;
    if (c === null || c.workSiteId !== null) return;
    if (!this.gameHoseSceneReady(agent, c)) return;
    agent.working = true;
  }

  /** Departure from a node, work dwell, or completion of the committed plan. */
  private advanceFromNode(agent: TruthAgent, c: Commitment, stepStartMs: number): void {
    const plan = c.plan;
    const atApproachEnd = c.legIndex >= c.approachCount;
    if (c.hasWork && atApproachEnd && stepStartMs < plan.workInterval.endMs) {
      if (stepStartMs < plan.workInterval.startMs) return;
      const suppress = plan.work?.kind === "suppress_fire" ? plan.work : undefined;
      if (suppress !== undefined && this.fire.state[suppress.gridCellIndex] !== CELL_BURNING) {
        this.cancel(agent, c, "containment_cell_not_burning", stepStartMs + STEP);
        return;
      }
      if (suppress !== undefined && !this.gameChanges) {
        if (agent.pos.kind !== "node" || !this.nodeCanSuppressCell(agent.pos.nodeId, suppress.gridCellIndex)) return;
      }
      if (suppress !== undefined && this.gameChanges) this.refreshGameSuppressWork(agent);
      else agent.working = true;
      return;
    }
    const entry = scheduledLegs(plan)[c.legIndex];
    if (entry === undefined) {
      if (c.hasWork && stepStartMs < plan.workInterval.endMs) return;
      this.notices.push({ tick: stepStartMs + STEP, kind: "plan_complete", agentId: agent.id, planId: plan.id });
      agent.commitment = null;
      return;
    }
    const leg = entry.leg;
    if (stepStartMs < leg.departMs) return;
    if (entry.kind === "offroad") {
      if (this.gameChanges && plan.work?.kind === "suppress_fire") {
        const p = this.agentPointXY(agent);
        const near = this.nearestBurningCellDistM(p.x, p.y);
        if (near < gameHoseDangerRadiusM() && this.crewCanHoseFrom(agent, p.x, p.y)) {
          this.refreshGameSuppressWork(agent);
          return;
        }
      }
      c.blockedNoticed = false;
      const off = entry.leg;
      agent.pos = {
        kind: "offroad",
        start: { x: off.start.x, y: off.start.y },
        end: { x: off.end.x, y: off.end.y },
        progress: 0,
      };
      return;
    }
    const edge = this.road.mustEdge(entry.leg.edgeId);
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
      dist: entry.leg.direction === "forward" ? 0 : edge.length,
      direction: entry.leg.direction,
      turnMs: 0,
    };
  }

  private cancel(agent: TruthAgent, c: Commitment, reason: string, tick: number): void {
    this.notices.push({ tick, kind: "plan_cancelled", agentId: agent.id, planId: c.plan.id, reason });
    agent.commitment = null;
  }

  private travelOffRoad(agent: TruthAgent, pos: Extract<Pos, { kind: "offroad" }>, meters: number): void {
    const total = Math.hypot(pos.end.x - pos.start.x, pos.end.y - pos.start.y);
    if (total <= 0) {
      this.finishOffRoadLeg(agent);
      return;
    }
    const remaining = (1 - pos.progress) * total;
    const step = Math.min(meters, remaining);
    const ux = (pos.end.x - pos.start.x) / total;
    const uy = (pos.end.y - pos.start.y) / total;
    const samples = Math.max(1, Math.ceil(step));
    for (let i = 1; i <= samples; i++) {
      const d = (step * i) / samples;
      const x = pos.start.x + (pos.progress * total + d) * ux;
      const y = pos.start.y + (pos.progress * total + d) * uy;
      if (this.isBurningAt(x, y)) {
        pos.progress = Math.min(1, pos.progress + d / total);
        if (this.gameChanges && this.suppressMission(agent)) {
          this.refreshGameSuppressWork(agent);
          return;
        }
        this.lose(agent, this.timeMs + STEP);
        return;
      }
    }
    pos.progress = Math.min(1, pos.progress + step / total);
    if (pos.progress >= 1 - 1e-9) {
      this.finishOffRoadLeg(agent);
    }
  }

  private finishOffRoadLeg(agent: TruthAgent): void {
    const c = agent.commitment;
    if (c === null) return;
    const entry = scheduledLegs(c.plan)[c.legIndex];
    if (entry === undefined || entry.kind !== "offroad") {
      const pos = agent.pos;
      if (pos.kind === "offroad") agent.pos = { ...pos, progress: 1 };
      return;
    }
    const pos = agent.pos;
    if (pos.kind === "offroad") {
      const leg = entry.leg;
      const startOk = Math.hypot(pos.start.x - leg.start.x, pos.start.y - leg.start.y) < 1;
      const endOk = Math.hypot(pos.end.x - leg.end.x, pos.end.y - leg.end.y) < 1;
      if (!startOk || !endOk) {
        agent.pos = { ...pos, progress: 1 };
        return;
      }
    }
    const nodeId = nearestNodeId(this.road, entry.leg.end.x, entry.leg.end.y);
    const suppress = c.plan.work?.kind === "suppress_fire" ? c.plan.work : undefined;
    const endsAtSuppressCell =
      suppress !== undefined && this.distanceToCellM(entry.leg.end.x, entry.leg.end.y, suppress.gridCellIndex) <= 2;
    const hasWork = c.plan.workInterval.endMs > c.plan.workInterval.startMs;
    const endsAtFieldHalt = this.gameChanges && !hasWork && suppress === undefined;
    if (nodeId !== null) {
      agent.pos = { kind: "node", nodeId };
    } else if (endsAtSuppressCell || endsAtFieldHalt || this.endsAtGameLine(c.plan, entry.leg.end)) {
      agent.pos = {
        kind: "offroad",
        start: { x: entry.leg.start.x, y: entry.leg.start.y },
        end: { x: entry.leg.end.x, y: entry.leg.end.y },
        progress: 1,
      };
    } else {
      return;
    }
    c.legIndex += 1;
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
        if (this.gameChanges && this.suppressMission(agent)) {
          this.refreshGameSuppressWork(agent);
          return;
        }
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

  /** Game-changes: an off-road leg may end at this crew's end of its fire line. */
  private endsAtGameLine(plan: MissionPlan, end: { readonly x: number; readonly y: number }): boolean {
    const work = plan.work;
    return this.gameChanges && work?.kind === "build_line" && Math.hypot(end.x - work.start.x, end.y - work.start.y) <= 2;
  }

  /** Game-changes line crew on its shift (approach finished): it backs off fire like a hose crew. */
  private cuttingGameLine(agent: TruthAgent): boolean {
    const c = agent.commitment;
    return this.gameChanges && c !== null && c.plan.work?.kind === "build_line" && c.legIndex >= c.approachCount;
  }

  /**
   * Game-changes line work: the crew clears the first unburned line cell (from its own end) that is
   * not inside the fire danger radius, if it is within cutting reach; otherwise it walks there. With
   * no unburned cell left on the line the shift is over.
   */
  private cutGameLine(agent: TruthAgent, work: Extract<NonNullable<MissionPlan["work"]>, { kind: "build_line" }>, fraction: number): void {
    const cells = firelineCells(work.start, work.end);
    if (!cells.some((c) => this.fire.state[c] === CELL_UNBURNED)) {
      this.notices.push({ tick: this.timeMs + STEP, kind: "plan_complete", agentId: agent.id, planId: agent.commitment!.plan.id });
      agent.commitment = null;
      agent.working = false;
      return;
    }
    const danger = gameHoseDangerRadiusM();
    const next = cells.find((c) => {
      if (this.fire.state[c] !== CELL_UNBURNED) return false;
      const p = cellCenter(c);
      return this.nearestBurningCellDistM(p.x, p.y) >= danger;
    });
    if (next === undefined) return;
    const p = this.agentPointXY(agent);
    const target = cellCenter(next);
    if (Math.hypot(target.x - p.x, target.y - p.y) <= gameLineCutReachM()) {
      if (this.fire.applyClearance(next, fraction) === "completed") this.builtFirebreaks.add(next);
    } else if (offRoadSegmentTraversable(p.x, p.y, target.x, target.y)) {
      agent.pos = { kind: "offroad", start: { x: p.x, y: p.y }, end: { x: target.x, y: target.y }, progress: 0 };
    }
  }

  private registerFireline(start: MapPoint, end: MapPoint): void {
    const id = firelineId(start, end);
    if (this.firelines.has(id)) return;
    // Canonical direction (lower end cell first), so the stored line does not depend on who came first.
    const cells = firelineCells(start, end);
    const reversed = cells.length > 0 && cells[0]! > cells[cells.length - 1]!;
    const [a, b] = reversed ? [end, start] : [start, end];
    this.firelines.set(id, { id, start: a, end: b, cells: reversed ? cells.reverse() : cells, resolved: false });
  }

  /** One step of line clearing: each working crew clears the first unburned cell on its side, in reach. */
  private applyLineWork(dt: number): void {
    const fraction = (dt * SIM_DEFAULTS.lineWorkRate) / SIM_DEFAULTS.lineWorkPerCell;
    for (const agent of this.agents) {
      if (agent.state === "lost" || agent.role !== "protection_crew" || !agent.working) continue;
      const work = agent.commitment?.plan.work;
      if (work?.kind !== "build_line") continue;
      if (this.gameChanges) {
        this.cutGameLine(agent, work, fraction);
        continue;
      }
      const next = reachableFirelineCells(this.road, work.workNodeId, work.start, work.end).find((c) => this.fire.state[c] === CELL_UNBURNED);
      if (next === undefined) continue;
      if (this.fire.applyClearance(next, fraction) === "completed") this.builtFirebreaks.add(next);
    }
    for (const line of this.firelines.values()) {
      if (line.resolved || line.cells.some((c) => this.fire.state[c] === CELL_UNBURNED)) continue;
      line.resolved = true;
      const complete = line.cells.every((c) => this.fire.state[c] === CELL_NONBURNABLE);
      this.notices.push({ tick: this.timeMs + STEP, kind: "fireline_resolved", lineId: line.id, outcome: complete ? "complete" : "breached" });
    }
  }

  private nodeCanSuppressCell(nodeId: NodeId, gridCellIndex: number): boolean {
    const p = this.road.nodePoint(nodeId);
    const c = cellCenter(gridCellIndex);
    return Math.hypot(p.x - c.x, p.y - c.y) <= SIM_DEFAULTS.containmentReachM;
  }

  private distanceToCellM(x: number, y: number, gridCellIndex: number): number {
    const c = cellCenter(gridCellIndex);
    return Math.hypot(x - c.x, y - c.y);
  }

  /** True when actively burning fire is within hose reach; the crew turns to face it, so any side counts. */
  private crewCanHoseFrom(_agent: TruthAgent, x: number, y: number): boolean {
    return this.nearestBurningCellDistM(x, y) <= gameHoseRadiusM();
  }

  /**
   * Game-changes: the burning cell a crew turns its spray toward: its committed cell when that is
   * in reach, else the nearest burning cell in reach; null when no fire is within reach.
   */
  private hoseTargetCell(agent: TruthAgent, x: number, y: number): number | null {
    const r = gameHoseRadiusM();
    const work = agent.commitment?.plan.work;
    if (work?.kind === "suppress_fire" && this.fire.state[work.gridCellIndex] === CELL_BURNING) {
      if (this.distanceToCellM(x, y, work.gridCellIndex) <= r) return work.gridCellIndex;
    }
    let best: number | null = null;
    let bestD = r;
    for (const cell of this.fire.burningCells) {
      const d = this.distanceToCellM(x, y, cell);
      if (d < bestD || (d === bestD && best !== null && cell < best)) {
        best = cell;
        bestD = d;
      }
    }
    return best;
  }

  /** Turn the crew's spray toward the fire in reach, at most the turn rate per step. */
  private turnHose(agent: TruthAgent, dt: number): void {
    const p = this.agentPointXY(agent);
    const cell = this.hoseTargetCell(agent, p.x, p.y);
    if (cell === null) {
      agent.hoseAim = null;
      return;
    }
    const c = cellCenter(cell);
    const len = Math.hypot(c.x - p.x, c.y - p.y);
    if (len < 1e-6) return;
    const want = { x: (c.x - p.x) / len, y: (c.y - p.y) / len };
    const travel = this.travelHeadingXY(agent);
    const from = agent.hoseAim ?? (travel === null ? want : { x: travel.hx, y: travel.hy });
    agent.hoseAim = turnToward(from, want, ((GAME_CHANGES.hoseTurnRateDegPerSec * Math.PI) / 180) * dt);
  }

  private cellInAgentHoseCone(agent: TruthAgent, x: number, y: number, gridCellIndex: number): boolean {
    const heading = this.agentHoseHeadingXY(agent);
    if (heading === null) return false;
    const cc = cellCenter(gridCellIndex);
    return hoseCellInCone(x, y, heading.hx, heading.hy, cc.x, cc.y, gameHoseRadiusM(), gameHoseConeMinDot());
  }

  /** The way the crew's spray faces: turned toward fire in reach, else the way it travels. */
  private agentHoseHeadingXY(agent: TruthAgent): { hx: number; hy: number } | null {
    if (this.gameChanges && agent.hoseAim !== null) return { hx: agent.hoseAim.x, hy: agent.hoseAim.y };
    return this.travelHeadingXY(agent);
  }

  /** Unit vector in the direction the crew is moving (or facing its committed cell while working). */
  private travelHeadingXY(agent: TruthAgent): { hx: number; hy: number } | null {
    const c = agent.commitment;
    if (agent.pos.kind === "edge") {
      const pos = agent.pos;
      const edge = this.road.mustEdge(pos.edgeId);
      const sign = pos.direction === "forward" ? 1 : -1;
      const d0 = pos.dist;
      const d1 = Math.min(edge.length, Math.max(0, d0 + sign * 2));
      const p0 = this.road.pointAlong(edge, d0);
      const p1 = this.road.pointAlong(edge, d1);
      const dx = p1.x - p0.x;
      const dy = p1.y - p0.y;
      const len = Math.hypot(dx, dy);
      if (len < 1e-6) return null;
      return { hx: dx / len, hy: dy / len };
    }
    if (agent.pos.kind === "offroad") {
      const pos = agent.pos;
      let dx = pos.end.x - pos.start.x;
      let dy = pos.end.y - pos.start.y;
      let len = Math.hypot(dx, dy);
      if (len < 1e-6 && c?.plan.work?.kind === "suppress_fire") {
        const p = this.agentPointXY(agent);
        const cc = cellCenter(c.plan.work.gridCellIndex);
        dx = cc.x - p.x;
        dy = cc.y - p.y;
        len = Math.hypot(dx, dy);
      }
      if (len < 1e-6) return null;
      return { hx: dx / len, hy: dy / len };
    }
    if (agent.pos.kind === "node") {
      const p = this.road.nodePoint(agent.pos.nodeId);
      if (c?.plan.work?.kind === "suppress_fire") {
        const cc = cellCenter(c.plan.work.gridCellIndex);
        const dx = cc.x - p.x;
        const dy = cc.y - p.y;
        const len = Math.hypot(dx, dy);
        if (len >= 1e-6) return { hx: dx / len, hy: dy / len };
      }
      const legs = c === null ? [] : scheduledLegs(c.plan);
      const idx = Math.min(Math.max(0, c?.legIndex ?? 0), legs.length) - 1;
      if (idx >= 0) {
        const entry = legs[idx];
        if (entry?.kind === "road") {
          const edge = this.road.mustEdge(entry.leg.edgeId);
          const sign = entry.leg.direction === "forward" ? 1 : -1;
          const fromDist = sign > 0 ? Math.max(0, edge.length - 3) : Math.min(edge.length, 3);
          const p0 = this.road.pointAlong(edge, fromDist);
          const dx = p.x - p0.x;
          const dy = p.y - p0.y;
          const len = Math.hypot(dx, dy);
          if (len >= 1e-6) return { hx: dx / len, hy: dy / len };
        }
      }
    }
    return null;
  }

  /** On-scene suppression: approach finished and physically near the fire line (not max spray reach from refuge). */
  private gameHoseSceneReady(agent: TruthAgent, c: Commitment | null): boolean {
    if (!this.gameChanges || c === null || c.plan.work?.kind !== "suppress_fire") return false;
    const p = this.agentPointXY(agent);
    const onScene = gameHoseOnSceneRadiusM();
    const nearBurn = this.nearestBurningCellDistM(p.x, p.y);
    if (GAME_CHANGES.requireApproachBeforeHose && c.legIndex < c.approachCount) {
      if (nearBurn > onScene) return false;
      if (agent.pos.kind === "node" && this.road.refugeNodes.has(agent.pos.nodeId)) return false;
      return this.crewCanHoseFrom(agent, p.x, p.y);
    }
    const target = c.plan.work.gridCellIndex;
    if (this.fire.state[target] === CELL_BURNING) {
      return this.distanceToCellM(p.x, p.y, target) <= gameHoseRadiusM();
    }
    return this.crewCanHoseFrom(agent, p.x, p.y);
  }

  private isTacticalOffroad(agent: TruthAgent): boolean {
    const pos = agent.pos;
    if (pos.kind !== "offroad") return false;
    const c = agent.commitment;
    if (c === null) return true;
    const entry = scheduledLegs(c.plan)[c.legIndex];
    if (entry === undefined || entry.kind !== "offroad") return true;
    const leg = entry.leg;
    const startOk = Math.hypot(pos.start.x - leg.start.x, pos.start.y - leg.start.y) < 1;
    const endOk = Math.hypot(pos.end.x - leg.end.x, pos.end.y - leg.end.y) < 1;
    return !startOk || !endOk;
  }

  /** Back away from fire when inside the danger radius while on a suppress mission. */
  private applyFireStandoff(agent: TruthAgent): void {
    if (agent.state === "lost") return;
    const p = this.agentPointXY(agent);
    const near = this.nearestBurningCellDistM(p.x, p.y);
    if (near >= gameHoseDangerRadiusM()) return;

    const stepM = SIM_DEFAULTS.agentSpeedMps * (STEP / 1000);
    let bestCell: number | null = null;
    let bestD = Infinity;
    for (const cell of this.fire.burningCells) {
      const d = this.distanceToCellM(p.x, p.y, cell);
      if (d < bestD) {
        bestD = d;
        bestCell = cell;
      }
    }
    if (bestCell === null) return;
    const cc = cellCenter(bestCell);
    let dx = p.x - cc.x;
    let dy = p.y - cc.y;
    let len = Math.hypot(dx, dy);
    if (len < 1e-3) {
      dx = 1;
      dy = 0;
      len = 1;
    } else {
      dx /= len;
      dy /= len;
    }
    const want = gameHoseStandoffTargetM();
    const moveM = Math.min(stepM * 2, Math.max(stepM, want - bestD));
    const nx = p.x + dx * moveM;
    const ny = p.y + dy * moveM;

    if (agent.pos.kind === "edge") {
      const pos = agent.pos;
      const edge = this.road.mustEdge(pos.edgeId);
      const sign = pos.direction === "forward" ? 1 : -1;
      const rev = pos.dist - sign * moveM;
      if (rev >= 0 && rev <= edge.length) {
        const rp = this.road.pointAlong(edge, rev);
        const rd = this.nearestBurningCellDistM(rp.x, rp.y);
        if (!this.isBurningAt(rp.x, rp.y) && rd > bestD) {
          pos.dist = rev;
          return;
        }
      }
    }

    if (this.isBurningAt(nx, ny)) return;
    if (!offRoadSegmentTraversable(p.x, p.y, nx, ny)) return;
    agent.pos = {
      kind: "offroad",
      start: { x: p.x, y: p.y },
      end: { x: nx, y: ny },
      progress: 0,
    };
  }

  private nearestBurningCellDistM(x: number, y: number): number {
    let best = Infinity;
    for (const cell of this.fire.burningCells) {
      best = Math.min(best, this.distanceToCellM(x, y, cell));
    }
    return best;
  }

  private applyHoseToCell(agentId: AgentId, cell: number, dt: number, rateMultiplier: number): void {
    const hoseScale = SIM_DEFAULTS.containmentWorkRequired / gameContainmentWorkRequired();
    const rate =
      SIM_DEFAULTS.containmentWorkRate * GAME_CHANGES.hoseWorkRateMultiplier * rateMultiplier * hoseScale * this.collaborationMultiplier(cell, agentId);
    const newlyDone = this.fire.applyContainmentWork(cell, dt * rate);
    if (newlyDone) this.finishContainment(agentId, cell);
  }

  private agentPointXY(agent: TruthAgent): { x: number; y: number } {
    return this.agentPoint(agent);
  }

  /** Whether suppression work is reachable once the committed approach is complete. */
  private canCommitSuppressWork(
    agent: TruthAgent,
    gridCellIndex: number,
    plan: MissionPlan,
    approachEndNode: NodeId | null,
  ): boolean {
    if (this.canSuppressCellFromAgent(agent, gridCellIndex, plan)) return true;
    if (approachEndNode !== null) {
      const p = this.road.nodePoint(approachEndNode);
      if (this.gameChanges) {
        if (this.distanceToCellM(p.x, p.y, gridCellIndex) <= gameHoseRadiusM()) return true;
      } else if (this.nodeCanSuppressCell(approachEndNode, gridCellIndex)) {
        return true;
      }
    }
    const off = plan.offroadLegs ?? [];
    if (this.gameChanges && off.length > 0) {
      const last = off[off.length - 1]!;
      if (this.distanceToCellM(last.end.x, last.end.y, gridCellIndex) <= gameHoseRadiusM()) return true;
    }
    return false;
  }

  /** Game-changes: within line-suppression range, or legacy road-node reach. */
  private canSuppressCellFromAgent(agent: TruthAgent, gridCellIndex: number, plan: MissionPlan): boolean {
    if (!this.gameChanges) {
      return agent.pos.kind === "node" && this.nodeCanSuppressCell(agent.pos.nodeId, gridCellIndex);
    }
    const p = this.agentPointXY(agent);
    if (this.distanceToCellM(p.x, p.y, gridCellIndex) <= gameHoseRadiusM()) return true;
    const off = plan.offroadLegs ?? [];
    if (off.length > 0) {
      const last = off[off.length - 1]!;
      if (this.distanceToCellM(last.end.x, last.end.y, gridCellIndex) <= gameHoseRadiusM()) return true;
    }
    if (agent.pos.kind === "node") return this.nodeCanSuppressCell(agent.pos.nodeId, gridCellIndex);
    return false;
  }

  /** Other crews hosing the same cell add work rate; spraying from the same side (a line) adds more. */
  private collaborationMultiplier(cell: number, selfId: AgentId): number {
    const self = this.agent(selfId);
    const selfHeading = this.agentHoseHeadingXY(self);
    let bonus = 0;
    for (const other of this.agents) {
      if (other.id === selfId || other.state === "lost" || other.role !== "protection_crew" || !other.spraying) continue;
      const p = this.agentPointXY(other);
      if (!this.cellInAgentHoseCone(other, p.x, p.y, cell)) continue;
      bonus += gameCollaborationBonus(selfHeading, this.agentHoseHeadingXY(other));
    }
    return 1 + bonus;
  }

  private finishContainment(agentId: AgentId, cell: number): void {
    if (this.gameChanges && GAME_CHANGES.extinguishOnContainmentComplete) this.fire.extinguishCell(cell);
    this.notices.push({
      tick: this.timeMs + STEP,
      kind: "containment_completed",
      agentId,
      gridCellIndex: cell,
      outcome: "succeeded",
      reasonCode: "containment_work_complete",
    });
  }

  private applyWorkAndDamage(): void {
    const dt = STEP / 1000;
    this.applyLineWork(dt);
    if (this.gameChanges) {
      // Any crew with fire in hose reach turns to face it and sprays its 180° cone, whatever its job.
      for (const agent of this.agents) {
        if (agent.state === "lost" || agent.role !== "protection_crew") {
          agent.hoseAim = null;
          agent.spraying = false;
          continue;
        }
        this.turnHose(agent, dt);
        const work = agent.commitment?.plan.work;
        const focusCell = work?.kind === "suppress_fire" ? work.gridCellIndex : null;
        const p = this.agentPointXY(agent);
        const hit = agent.hoseAim === null ? [] : [...this.fire.burningCells].filter((cell) => this.cellInAgentHoseCone(agent, p.x, p.y, cell));
        for (const cell of hit) this.applyHoseToCell(agent.id, cell, dt, cell === focusCell ? 1.25 : 1);
        agent.spraying = hit.some((cell) => this.fire.state[cell] === CELL_BURNING);
      }
    } else {
      for (const agent of this.agents) {
        if (agent.state === "lost" || agent.role !== "protection_crew" || !agent.working) continue;
        const work = agent.commitment?.plan.work;
        if (work?.kind !== "suppress_fire") continue;
        if (agent.pos.kind !== "node") continue;
        if (!this.nodeCanSuppressCell(agent.pos.nodeId, work.gridCellIndex)) continue;
        const newlyDone = this.fire.applyContainmentWork(work.gridCellIndex, dt * SIM_DEFAULTS.containmentWorkRate);
        if (newlyDone) this.finishContainment(agent.id, work.gridCellIndex);
      }
    }
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

  /** Maps truth commitment to domain `AgentState` (contract gap #3: returning/stranded/holding/planning collapse here). */
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
      // Return legs and pre-departure holding both surface as "approaching" to the coordinator.
      agent.state = "approaching";
    }
  }

  /** At the terminal step: record missions still under way as interrupted, never as returns. */
  interruptCommitments(): void {
    for (const agent of this.agents) {
      if (agent.state === "lost" || agent.commitment === null) continue;
      this.notices.push({ tick: this.timeMs, kind: "plan_interrupted_by_end", agentId: agent.id, planId: agent.commitment.plan.id });
    }
  }

  toAgentPosition(agent: TruthAgent): AgentPosition {
    if (agent.pos.kind === "node") return { kind: "node", nodeId: agent.pos.nodeId };
    if (agent.pos.kind === "offroad") {
      return OffroadPosition.parse({
        kind: "offroad",
        start: { x: agent.pos.start.x, y: agent.pos.start.y },
        end: { x: agent.pos.end.x, y: agent.pos.end.y },
        progress: agent.pos.progress,
      });
    }
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
}
