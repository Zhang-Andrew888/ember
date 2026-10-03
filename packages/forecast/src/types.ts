import type { SimTimeMs } from "@ember/domain";
import type { AgentKnowledgeSnapshot } from "@ember/knowledge";

export type ForecastReliability = "reliable" | "unreliable" | "rebuilding";

export interface ForecastMember {
  readonly id: string;
  readonly spreadMultiplier: number;
  readonly windDirectionDegrees: number;
  readonly windShiftTimeMs: SimTimeMs;
  readonly postShiftDirectionDegrees: number;
  /** Per-cell first ignition times; key is `${edgeId}:${cellIndex}`. */
  readonly cellIgnitionMs: ReadonlyMap<string, SimTimeMs>;
}

export interface ForecastEnsemble {
  readonly inputHash: string;
  readonly knowledgeRevision: number;
  readonly members: readonly ForecastMember[];
  readonly reliability: ForecastReliability;
  readonly builtAtMs: SimTimeMs;
  readonly sourceSnapshot: AgentKnowledgeSnapshot;
}
