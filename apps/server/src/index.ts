// apps/server - owns: session management, WebSocket transport, Grok Voice integration
// Must not: own authoritative world advancement (delegates to simulation worker)
// Status: runner, session, conversation bridge and evaluation harness are implemented against the
// no-provider adapter. WebSocket transport and the real Grok adapter are still Slice 0/5 integration work.
export { IncidentRunner, type MonotonicClock, type RunnerOptions, type TechnicalFailure } from "./runner.js";
export { IncidentSession, type LoggedDecision, type SessionOptions, type ControllerFactory } from "./session.js";
export { ConversationBridge, directoryFor, type BridgeOptions, type TranscriptEntry } from "./conversation.js";
export { ScriptedCoordinatorPolicy, POLICY_NAME, POLICY_VERSION, type RelayLogEntry } from "./policy.js";
export {
  DEV_SEEDS,
  HELD_OUT_SEEDS,
  SHOWCASE_SEED,
  VARIANTS,
  factoryFor,
  overridesForSeed,
  runEvaluation,
  runVariant,
  type EvaluationReport,
  type Fault,
  type RunOptions,
  type RepresentativeFailure,
  type RunResult,
  type Variant,
  type VariantReport,
} from "./evaluation.js";
