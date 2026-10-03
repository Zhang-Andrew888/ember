// packages/agents - owns: objectives, lifecycle, independent selection, explanations
// Must not: use coordinator omniscience or global knowledge sync
export * from "./types.js";
export { CrewController, type ControllerOptions } from "./controller.js";
export { DispatchController } from "./dispatch.js";
export { ScoutController, edgeImportance } from "./scout.js";
export { EvidenceTracker } from "./evidence.js";
export { explain } from "./explain.js";
export { runControllers, type RunLog } from "./testing.js";
