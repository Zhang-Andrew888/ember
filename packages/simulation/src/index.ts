// packages/simulation - owns: truth state, clock, motion, fire, damage, end conditions
// Must not: make LLM requests
export type { SimulationAPI } from "@ember/domain";
export * from "./clock.js";
export * from "./inputs.js";
export * from "./scenario.js";
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
