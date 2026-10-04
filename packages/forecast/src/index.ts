// packages/forecast - owns: candidate futures conditioned on one knowledge snapshot
// Must not: use hidden world state or truth seed
export type {
  ForecastEnsemble,
  ForecastParams,
  ForecastParameterRanges,
  ForecastEvent,
  ForecastMember,
  ForecastReliability,
  MemberKind,
  ParameterRange,
  ParameterRanges,
} from "./types.js";
export { DEFAULT_FORECAST_CONFIG, widenRanges, type ForecastConfig } from "./config.js";
export { ForecastService, directlyObservedClosed, snapshotScopeHash } from "./service.js";
export {
  admitsProtection,
  burnFractionAt,
  earliestIgnitionMs,
  ensembleValidity,
  rankedIgnitionMs,
  type EnsembleValidity,
} from "./ensemble.js";
export { fitMember, fitObservations, type FitObservation } from "./fit.js";
export { rolloutContext, rolloutIgnition } from "./rollout.js";
export { observeFire, briefingObservation, snapshotOf, type Observer } from "./testing.js";
export { edgeArrivalBands, toCoordinatorForecastView } from "./coordinator-projection.js";
export { calibrateArrivalPadding, arrivalCoverage, type ArrivalCalibrationCase } from "./calibration.js";
