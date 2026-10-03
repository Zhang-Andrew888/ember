import { describe, expect, it } from "vitest";
import { AgentId } from "@ember/domain";
import { buildSyntheticScenario } from "@ember/simulation";
import { RoadIndex } from "@ember/simulation/model";
import { ForecastService } from "./service.js";
import { briefingObservation, snapshotOf } from "./testing.js";
import { toCoordinatorForecastView } from "./coordinator-projection.js";

describe("coordinator forecast projection", () => {
  it("builds edge arrival bands without truth parameters", () => {
    const scenario = buildSyntheticScenario();
    const road = new RoadIndex(scenario.map);
    const coordinator = AgentId.parse("coordinator");
    const service = new ForecastService(coordinator, scenario.map);
    const snap = snapshotOf(coordinator, [briefingObservation(scenario.map)], 0);
    const ensemble = service.update(snap, 0);
    const view = toCoordinatorForecastView(ensemble, road, 0, null);
    expect(view?.supportedMemberCount).toBeGreaterThan(0);
    expect(view?.edgeArrivals.length).toBe(scenario.map.edges.length);
    expect(JSON.stringify(view)).not.toContain("spreadMultiplier");
  });
});
