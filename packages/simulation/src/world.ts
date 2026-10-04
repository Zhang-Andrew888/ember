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
  type FireParams,
  type RoadEdge,
} from "./model/index.js";
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
  timeMs = 0;

  constructor(scenario: SimScenario, privateParams: PrivateWorldParameters) {
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
        if (endNode === null) return reject("offroad_end_not_at_node");
        if (i === 0) {
          const p = this.agentPoint(agent);
          if (!near(p.x, p.y, leg.start.x, leg.start.y)) return reject("offroad_not_connected");
        } else if (cursor !== null) {
          const startPt = this.road.nodePoint(cursor);
          if (!near(startPt.x, startPt.y, leg.start.x, leg.start.y)) return reject("offroad_not_connected");
        } else {
          return reject("offroad_not_connected");
        }
        cursor = endNode;
        if (i === approachCount - 1) approachEndNode = cursor;
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
      if (hasWork) {
        const endNode = approachEndNode ?? (agent.pos.kind === "node" && approachCount === 0 ? agent.pos.nodeId : null);
        if (endNode !== line.workNodeId) return reject("fireline_work_not_at_start_node");
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
      const endNode =
        approachEndNode ??
        (agent.pos.kind === "node" && approachCount === 0 ? agent.pos.nodeId : null);
      if (endNode === null) return reject("containment_work_not_at_node");
      if (!this.nodeCanSuppressCell(endNode, suppress.gridCellIndex)) return reject("containment_cell_unreachable");
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

    if (agent.pos.kind === "node" && c !== null) {
      this.advanceFromNode(agent, c, stepStartMs);
    }

    if (agent.pos.kind === "offroad") {
      const pos = agent.pos;
      if (c !== null && c.legIndex < scheduledLegCount(c.plan)) {
        const entry = scheduledLegs(c.plan)[c.legIndex];
        const factor = entry?.kind === "offroad" ? entry.leg.speedFactor : SIM_DEFAULTS.offRoadSpeedFactor;
        this.travelOffRoad(agent, pos, SIM_DEFAULTS.agentSpeedMps * factor * (STEP / 1000));
      }
    }

    if (agent.pos.kind === "edge") {
      const pos = agent.pos;
      if (pos.turnMs > 0) {
        pos.turnMs = Math.max(0, pos.turnMs - STEP);
      } else if (agent.commitment !== null && agent.commitment.legIndex < scheduledLegCount(agent.commitment.plan)) {
        // With no commitment, or one whose legs are exhausted (a halt), a mid-edge agent keeps
        // still: a forced emergency stop.
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
      if (stepStartMs < plan.workInterval.startMs) return;
      const suppress = plan.work?.kind === "suppress_fire" ? plan.work : undefined;
      if (suppress !== undefined && this.fire.state[suppress.gridCellIndex] !== CELL_BURNING) {
        this.cancel(agent, c, "containment_cell_not_burning", stepStartMs + STEP);
        return;
      }
      agent.working = true;
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
    if (entry === undefined || entry.kind !== "offroad") return;
    const nodeId = nearestNodeId(this.road, entry.leg.end.x, entry.leg.end.y);
    if (nodeId === null) return;
    agent.pos = { kind: "node", nodeId };
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

  private applyWorkAndDamage(): void {
    const dt = STEP / 1000;
    this.applyLineWork(dt);
    for (const agent of this.agents) {
      if (agent.state === "lost" || agent.role !== "protection_crew" || !agent.working) continue;
      const work = agent.commitment?.plan.work;
      if (work?.kind !== "suppress_fire") continue;
      const cell = work.gridCellIndex;
      const newlyDone = this.fire.applyContainmentWork(cell, dt * SIM_DEFAULTS.containmentWorkRate);
      if (newlyDone) {
        this.notices.push({
          tick: this.timeMs + STEP,
          kind: "containment_completed",
          agentId: agent.id,
          gridCellIndex: cell,
          outcome: "succeeded",
          reasonCode: "containment_work_complete",
        });
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
