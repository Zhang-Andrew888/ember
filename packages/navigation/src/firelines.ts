import type { NodeId } from "@ember/domain";
import { SIM_DEFAULTS, firelineId, reachableFirelineCells } from "@ember/simulation/model";
import type { RoadIndex } from "@ember/simulation/model";
import { workOptions } from "./mission.js";
import { DEFAULT_NAV_CONFIG, type MissionTarget, type NavConfig } from "./types.js";

/**
 * Mission target for clearing a fire line from `from` toward `to`. The crew plans to clear every
 * cell it can reach from `from`; a partner on the other end only shortens the real job, so one crew
 * can start without the other. The forecast decides how much of that work time is safe.
 */
export function firelineTarget(
  road: RoadIndex,
  from: NodeId,
  to: NodeId,
  workRate: number = SIM_DEFAULTS.lineWorkRate,
  config: NavConfig = DEFAULT_NAV_CONFIG,
): MissionTarget | null {
  const cells = reachableFirelineCells(road, from, to);
  const required = cells.length * SIM_DEFAULTS.lineWorkPerCell;
  const options = workOptions(required, workRate, config.minWorkMs, config.workStepMs);
  if (options.length === 0) return null;
  return {
    id: `${firelineId(from, to)}@${from}`,
    kind: "line",
    nodeId: from,
    siteId: null,
    line: { fromNodeId: from, toNodeId: to },
    value: 1,
    workOptionsMs: options,
    benefit: (workMs) => Math.min(1, ((workMs / 1000) * workRate) / required),
  };
}
