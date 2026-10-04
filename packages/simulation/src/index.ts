// packages/simulation - owns: truth state, clock, motion, fire, damage, end conditions
// Must not: make LLM requests
//
// Authoritative runtime: `Incident`, `recordOf`, `replayRecord` — not the `SimulationAPI`
// interface in @ember/domain (see packages/simulation/CONTRACT_GAPS.md, issue #3).
export type { SimulationAPI } from "@ember/domain";
export * from "./clock.js";
export * from "./inputs.js";
export * from "./scenario.js";
export * from "./firebreaks.js";
export { osmMontclairGameScenario, osmMontclairScenario } from "./scenario-osm.js";
export * from "./harness.js";
export { Incident, type AgentProjection, type IncidentOptions, type TruthSnapshot } from "./incident.js";
export {
  World,
  derivePrivateParameters,
  type PrivateOverrides,
  type PrivateWorldParameters,
  type SimNotice,
} from "./world.js";
export * from "./record.js";
export { canonicalJson, hashText, hashValue } from "./model/index.js";
export { SIM_DEFAULTS } from "./model/index.js";
export { scenarioGates, validateScenario, type GateResult } from "./validate.js";
