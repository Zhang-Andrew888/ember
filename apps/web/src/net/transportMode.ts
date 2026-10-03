import type { StartPlan } from "./startPlan.js";

/** Whether the UI talks to a real server or the in-browser mock socket. */
export type TransportMode = "live" | "mock";

export function transportModeFromStartPlan(plan: StartPlan): TransportMode {
  return plan.kind === "mock" ? "mock" : "live";
}
