import type { NodeId } from "@ember/domain";
import { planMissions, type MissionSearchResult, type MissionTarget, type PlanningContext } from "@ember/navigation";
import { cellsWithin, type RoadIndex } from "@ember/simulation/model";
import { CrewController, type ControllerOptions } from "./controller.js";

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
 * point, ranked by forecast disagreement about corridor closure times public access importance
 * per unit of travel, dwell and return time. Recently observed points rest for a cooldown
 * unless new fire evidence arrived.
 */
export class ScoutController extends CrewController {
  private readonly importance: Map<string, number>;
  private readonly visitedAt = new Map<string, number>();
  private lastFireEvidenceMs = -Infinity;
  private evidenceSeenAtVisit = new Map<string, number>();
  private lastFireIds = "";

  constructor(options: ControllerOptions) {
    super({ ...options, role: "scout" });
    this.importance = edgeImportance(this.road);
  }

  /** Disagreement among retained members about whether a corridor is closed at tMs, in [0, 1]. */
  disagreement(ctx: PlanningContext, edgeId: string, tMs: number): number {
    const members = ctx.ensemble.members;
    if (members.length === 0) return 0;
    const edge = this.road.mustEdge(edgeId as never);
    let closed = 0;
    for (const m of members) {
      if (edge.cells.some((c) => m.ignitionMs[c.cell]! <= tMs)) closed += 1;
    }
    const f = closed / members.length;
    return 4 * f * (1 - f);
  }

  override candidateSearch(ctx: PlanningContext, allowed: ReadonlySet<string> | null): MissionSearchResult {
    const now = ctx.nowMs;
    const targets: MissionTarget[] = [];
    for (const point of this.map.scoutPoints) {
      if (allowed !== null && !allowed.has(point)) continue;
      const last = this.visitedAt.get(point);
      const fresh = this.lastFireEvidenceMs > (this.evidenceSeenAtVisit.get(point) ?? -Infinity);
      if (allowed === null && last !== undefined && now - last < REVISIT_COOLDOWN_MS && !fresh) continue;
      const p = this.road.nodePoint(point);
      const nearby = new Set(cellsWithin(p.x, p.y, OBSERVATION_RADIUS_M));
      const edges = [...this.road.edges.values()].filter((e) => e.cells.some((c) => nearby.has(c.cell)));
      const relevantMs = now + 120_000;
      let benefit = 0;
      for (const e of edges) benefit += this.disagreement(ctx, e.id, relevantMs) * (this.importance.get(e.id) ?? 0);
      // A little weight keeps equally uninformative points ordered by travel time, not ignored.
      benefit += 1e-6;
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
