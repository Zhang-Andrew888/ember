import { scheduledLegs, type ScheduledLeg } from "@ember/domain";
import type { MissionPlan, NodeId } from "@ember/domain";
import type { RoadIndex } from "./model/index.js";

export { scheduledLegs, type ScheduledLeg };

export function nearestNodeId(road: RoadIndex, x: number, y: number, maxDistM = 5): NodeId | null {
  let best: NodeId | null = null;
  let bestD = maxDistM;
  for (const node of road.map.nodes) {
    const d = Math.hypot(node.x - x, node.y - y);
    if (d <= bestD) {
      bestD = d;
      best = node.id;
    }
  }
  return best;
}

export function planSchedule(plan: MissionPlan): ScheduledLeg[] {
  return scheduledLegs(plan);
}
