import { SimScenario } from "./scenario.js";
import { osmMontclairScenarioJson } from "./osm-montclair-scenario.generated.js";

/**
 * The frozen Montclair scenario: real OpenStreetMap road geometry (© OpenStreetMap contributors, ODbL)
 * with authored terrain, sites, refuges, scouting points, the single-capacity segment and ignition. Source
 * and crop details are in data/scenario-osm-montclair-v1.provenance.json; regenerate with
 * scripts/osm-to-scenario.mjs. The synthetic scenario stays the default; this one is opt-in.
 */
export function osmMontclairScenario(): SimScenario {
  return SimScenario.parse(osmMontclairScenarioJson);
}
