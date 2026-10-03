import type { NodeId } from "@ember/domain";
import { planMissions, type MissionSearchResult, type MissionTarget, type PlanningContext } from "@ember/navigation";
import { cellsWithin, type RoadIndex } from "@ember/simulation/model";
import { CrewController, type ControllerOptions } from "./controller.js";
import { scoreObservationPoint, type VoiScore } from "./voi.js";

const SCOUT_DWELL_MS = 10_000;
const REVISIT_COOLDOWN_MS = 60_000;
const OBSERVATION_RADIUS_M = 150;

/**
 * Public site-access importance of each road edge: the summed value of sites whose shortest
 * approach from any refuge gets longer (or disappears) if that edge is lost. Uses only the
 * public map.
 */
export function edgeImportance(road: RoadIndex): Map<string, number> {
  const length = (ban: string | null): Map<NodeId, number> => {
    const dist = new Map<NodeId, number>();
    const queue: NodeId[] = [];
    for (const r of road.map.refuges) {
      dist.set(r.nodeId, 0);
      queue.push(r.nodeId);
    }
    while (queue.length > 0) {
      queue.sort((a, b) => dist.get(a)! - dist.get(b)!);
      const n = queue.shift()!;
      for (const adj of road.adjacency.get(n) ?? []) {
        if (adj.edgeId === ban) continue;
        const d = dist.get(n)! + road.mustEdge(adj.edgeId).length;
        if (d < (dist.get(adj.toNode) ?? Infinity)) {
          dist.set(adj.toNode, d);
          queue.push(adj.toNode);
        }
      }
    }
    return dist;
  };
  const base = length(null);
  const out = new Map<string, number>();
  for (const edge of road.edges.values()) {
    const without = length(edge.id);
    let importance = 0;
    for (const site of road.map.sites) {
      const before = base.get(site.nodeId) ?? Infinity;
      const after = without.get(site.nodeId) ?? Infinity;
      if (after > before + 1e-6) importance += site.value;
    }
    out.set(edge.id, importance);
  }
  return out;
}

/**
 * Ground scout. Same movement, observation radius, forecast admission, withdrawal and loss
 * rules as a crew, but its mission is a short observation dwell at an authored scouting
 * point, ranked by value of information (expected bits about corridor closure among the retained
 * forecast members, weighted by public access importance, see voi.ts) per unit of travel, dwell
 * and return time. Recently observed points rest for a cooldown
 * unless new fire evidence arrived.
 */
export class ScoutController extends CrewController {
  private readonly importance: Map<string, number>;
  private readonly visitedAt = new Map<string, number>();
  private lastFireEvidenceMs = -Infinity;
  private evidenceSeenAtVisit = new Map<string, number>();
  private lastFireIds = "";
  private lastRanking: { point: string; score: VoiScore }[] = [];

  constructor(options: ControllerOptions) {
    super({ ...options, role: "scout" });
    this.importance = edgeImportance(this.road);
  }

  /** Value-of-information score of every point considered at the last candidate search, best first. */
  get voiRanking(): readonly { readonly point: string; readonly score: VoiScore }[] {
    return this.lastRanking;
  }

  override candidateSearch(ctx: PlanningContext, allowed: ReadonlySet<string> | null): MissionSearchResult {
    const now = ctx.nowMs;
    const targets: MissionTarget[] = [];
    const ranking: { point: string; score: VoiScore }[] = [];
    for (const point of this.map.scoutPoints) {
      if (allowed !== null && !allowed.has(point)) continue;
      const last = this.visitedAt.get(point);
      const fresh = this.lastFireEvidenceMs > (this.evidenceSeenAtVisit.get(point) ?? -Infinity);
      if (allowed === null && last !== undefined && now - last < REVISIT_COOLDOWN_MS && !fresh) continue;
      const p = this.road.nodePoint(point);
      const nearby = new Set(cellsWithin(p.x, p.y, OBSERVATION_RADIUS_M));
      const edges = [...this.road.edges.values()].filter((e) => e.cells.some((c) => nearby.has(c.cell)));
      const relevantMs = now + 120_000;
      const score = scoreObservationPoint({
        members: ctx.ensemble.members,
        edges: edges.map((e) => ({ id: e.id, cells: e.cells.map((c) => c.cell) })),
        importance: this.importance,
        closedCells: ctx.closedCells,
        relevantMs,
      });
      ranking.push({ point, score });
      // A little weight keeps equally uninformative points ordered by travel time, not ignored.
      const benefit = score.total + 1e-6;
      targets.push({
        id: point,
        kind: "observe",
        nodeId: point,
        siteId: null,
        value: 1,
        workOptionsMs: [SCOUT_DWELL_MS],
        benefit: () => benefit,
      });
    }
    this.lastRanking = ranking.sort((x, y) => y.score.total - x.score.total || (x.point < y.point ? -1 : 1));
    return planMissions(ctx, targets);
  }

  protected override missionVerb(id: string): string {
    return `scouting ${id}`;
  }

  override tick(...args: Parameters<CrewController["tick"]>): ReturnType<CrewController["tick"]> {
    const proj = args[0];
    const out = super.tick(...args);
    const fireIds = this.evidence.supportingObservationIds().join(",");
    if (fireIds !== this.lastFireIds || out.forecastEvents.length > 0) {
      this.lastFireIds = fireIds;
      this.lastFireEvidenceMs = Math.max(this.lastFireEvidenceMs, proj.simTimeMs);
    }
    const c = proj.commitment;
    if (c !== null && c.working) {
      const node = proj.position.kind === "node" ? proj.position.nodeId : null;
      if (node !== null) {
        this.visitedAt.set(node, proj.simTimeMs);
        this.evidenceSeenAtVisit.set(node, this.lastFireEvidenceMs);
      }
    }
    return out;
  }
}
