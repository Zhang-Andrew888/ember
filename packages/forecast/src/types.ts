import type { AgentId, SimTimeMs } from "@ember/domain";
import type { AgentKnowledgeSnapshot } from "@ember/knowledge";
import type { FireParams } from "@ember/simulation/model";

export type ForecastReliability = "reliable" | "unreliable" | "rebuilding";

export type MemberKind = "boundary" | "no_shift" | "sampled" | "replenished" | "rebuilt";

/** Forecast-only uncertainties; the simulator's private truth is never an input. */
export interface ForecastParams extends FireParams {
  /** Larger values slow local spread. */
  readonly moistureMultiplier?: number;
  /** A deterministic downwind ember jump, in grid cells. Zero disables spotting. */
  readonly spotDistanceCells?: number;
  readonly spotTimeMs?: number;
}

export interface ForecastMember {
  readonly id: string;
  readonly kind: MemberKind;
  readonly params: ForecastParams;
  /** Positive support weight after assimilating this version's observations. */
  readonly weight?: number;
  readonly parentMemberId?: string;
  /** First ignition time per flat grid cell in ms; Infinity if it does not ignite in the rollout. */
  readonly ignitionMs: Float64Array;
  /** The rollout is only trustworthy up to this time. */
  readonly rolloutEndMs: number;
}

export interface ParameterRange {
  readonly min: number;
  readonly max: number;
}

export interface ParameterRanges {
  readonly spreadMultiplier: ParameterRange;
  readonly windOffsetDeg: ParameterRange;
  readonly shiftTimeMs: ParameterRange;
  readonly postShiftDeg: ParameterRange;
  readonly moistureMultiplier?: ParameterRange;
  readonly spotDistanceCells?: ParameterRange;
  readonly spotTimeMs?: ParameterRange;
}

export type ForecastParameterRanges = ParameterRanges & Required<Pick<ParameterRanges,
  "moistureMultiplier" | "spotDistanceCells" | "spotTimeMs"
>>;

export interface ForecastEnsemble {
  /** Monotonically increasing for each newly published state of one forecast service. */
  readonly version: number;
  readonly parentVersion?: number | null;
  readonly inputHash: string;
  readonly knowledgeRevision: number;
  /** Supported members. Empty whenever the forecast is unreliable. */
  readonly members: readonly ForecastMember[];
  /**
   * Broadened candidates used only for emergency ranking while unreliable. Never normal
   * admission evidence.
   */
  readonly provisional: readonly ForecastMember[];
  readonly reliability: ForecastReliability;
  readonly builtAtMs: SimTimeMs;
  /** Forecast support ends here; later times are unknown, not safe. */
  readonly horizonEndMs: number;
  readonly arrivalPaddingMs?: number;
  /** 1 for the prior range, 2/4/8 after widening rounds. */
  readonly widenFactor: number;
  readonly ranges: ParameterRanges;
  readonly sourceSnapshot: AgentKnowledgeSnapshot;
  readonly observationIds?: readonly string[];
}

export type ForecastEvent =
  | {
      readonly kind: "contradiction";
      readonly agentId: AgentId;
      readonly atMs: number;
      readonly observationIds: readonly string[];
      readonly explanation: string;
    }
  | {
      readonly kind: "rebuild_complete";
      readonly agentId: AgentId;
      readonly atMs: number;
      readonly widenFactor: number;
      readonly ranges: ParameterRanges;
      readonly observationIds: readonly string[];
      readonly supportedCount: number;
      readonly explanation: string;
    }
  | {
      readonly kind: "rebuild_failed";
      readonly agentId: AgentId;
      readonly atMs: number;
      readonly ranges: ParameterRanges;
      readonly observationIds: readonly string[];
      readonly explanation: string;
    };
