import type { MapPoint, NodeId } from "@ember/domain";
import { SIM_DEFAULTS, firelineId, reachableFirelineCells } from "@ember/simulation/model";
import type { RoadIndex } from "@ember/simulation/model";
import { workOptions } from "./mission.js";
import { DEFAULT_NAV_CONFIG, type MissionTarget, type NavConfig } from "./types.js";

/** Why a crew cannot work its end of a line. */
export type FirelineRefusal = "no_road_near_line_end";

export type FirelineTargetResult =
  | { readonly ok: true; readonly target: MissionTarget }
  | { readonly ok: false; readonly reason: FirelineRefusal };

/**
 * The road node nearest `point` that lies within `reachM` of it, or null when there is none.
 * Ties go to the node listed first on the map, so the choice is deterministic.
 */
export function nearestRoadNodeWithin(road: RoadIndex, point: MapPoint, reachM: number = SIM_DEFAULTS.lineReachM): NodeId | null {
  let best: NodeId | null = null;
  let bestDist = Infinity;
  for (const id of road.nodes.keys()) {
    const q = road.nodePoint(id);
    const d = Math.hypot(q.x - point.x, q.y - point.y);
    if (d <= reachM && d < bestDist) {
      best = id;
      bestDist = d;
    }
  }
  return best;
}

/**
 * Mission target for a crew clearing the line from `start` to `end`, where `start` is the crew's own
 * end (a partner on the other end passes the ends the other way round). The crew works from the road
 * node nearest its end within `lineReachM`, and plans to clear every line cell in reach of that node;
 * a partner on the other end only shortens the real job, so one crew can start without the other. The
 * forecast decides how much of that work time is safe. With no road node in reach of the end, or no
 * line cell in reach of the node, the order is refused.
 */
export function firelineTarget(
  road: RoadIndex,
  start: MapPoint,
  end: MapPoint,
  workRate: number = SIM_DEFAULTS.lineWorkRate,
  config: NavConfig = DEFAULT_NAV_CONFIG,
): FirelineTargetResult {
  const refused: FirelineTargetResult = { ok: false, reason: "no_road_near_line_end" };
  const workNode = nearestRoadNodeWithin(road, start);
  if (workNode === null) return refused;
  const cells = reachableFirelineCells(road, workNode, start, end);
  const required = cells.length * SIM_DEFAULTS.lineWorkPerCell;
  const options = workOptions(required, workRate, config.minWorkMs, config.workStepMs);
  if (options.length === 0) return refused;
  return {
    ok: true,
    target: {
      id: `${firelineId(start, end)}@${workNode}`,
      kind: "line",
      nodeId: workNode,
      siteId: null,
      line: { workNodeId: workNode, start, end },
      value: 1,
      workOptionsMs: options,
      benefit: (workMs) => Math.min(1, ((workMs / 1000) * workRate) / required),
    },
  };
}
