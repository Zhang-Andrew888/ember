// packages/navigation - owns: complete timed mission search, feasibility checks, reservations
// Must not: issue unchecked movement commands
export * from "./types.js";
export { enumerateApproachRoutes, routeIdOf, edgeKeys, type ApproachDiscover, type ApproachRoute } from "./approach-routes.js";
export { HazardModel } from "./hazard.js";
export { Reach, ReturnTable, bucketTravelMs, startsFromPosition, timeExpandedSearch, type SearchStart } from "./search.js";
export { planMissions, planWithHazard, protectionTargets, workOptions } from "./mission.js";
export { directionalTargets, planDirectionalMove } from "./directional.js";
export { containmentTargets, nearestReachableNode } from "./containment.js";
export { certifyPlan, type CertifyFailure, type CertifyInput, type CertifyResult } from "./certify.js";
export { planRetreat, planReturn, type ReturnPlan } from "./retreat.js";
export { makeEnsemble, cellOnEdge, cellsOfEdge, type MemberSpec } from "./testing.js";
export {
  NAV_CALIBRATION_PRESETS,
  mergeNavConfig,
  presetNavConfig,
  type NavCalibrationPreset,
} from "./calibration-grid.js";
export {
  ReservationService,
  type Conflict,
  type Holding,
  type Occupant,
  type PriorityClass,
  type ReserveResult,
  type Window,
  type YieldHandler,
} from "./reservations.js";
