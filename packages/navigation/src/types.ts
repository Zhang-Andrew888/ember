import type { AgentId, MissionPlan, SiteId, SimTimeMs } from "@ember/domain";
import type { ForecastEnsemble } from "@ember/forecast";

export interface MissionSearchInput {
  readonly agentId: AgentId;
  readonly targetSiteId: SiteId;
  readonly fromSimTimeMs: SimTimeMs;
  readonly ensemble: ForecastEnsemble;
}

export interface MissionSearchResult {
  readonly feasible: boolean;
  readonly plan: MissionPlan | null;
  readonly limitingReason: string | null;
  /** Forecast member IDs that constrained this result. */
  readonly limitingMemberIds: readonly string[];
}
