// packages/knowledge - owns: observation history, scoped projections per agent
// Must not: use implicit global synchronization
export type { AgentKnowledgeSnapshot } from "./types.js";
export { canonicalJson, hashText, hashValue } from "./digest.js";
export {
  STALE_AFTER_MS,
  KnowledgeStore,
  toSimTime,
  type BurnState,
  type CellBelief,
  type Contradiction,
  type ContradictionKind,
  type Provenance,
  type SiteBelief,
} from "./store.js";
export { DEFAULT_RELAY_POLICY, selectRelay, type RelayCandidate, type RelayPolicy } from "./relay.js";
