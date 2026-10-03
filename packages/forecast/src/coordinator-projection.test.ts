import { describe, expect, it } from "vitest";
import { AgentId } from "@ember/domain";
import { buildSyntheticScenario } from "@ember/simulation";
import { RoadIndex } from "@ember/simulation/model";
import { ForecastService } from "./service.js";
import { briefingObservation, snapshotOf } from "./testing.js";
import { edgeArrivalBands, toCoordinatorForecastView } from "./coordinator-projection.js";
import { CoordinatorForecastView } from "@ember/domain";

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
    expect(CoordinatorForecastView.safeParse(view).success).toBe(true);
  });

  it("uses each member's first edge arrival and leaves invalid bands unknown", () => {
    const scenario = buildSyntheticScenario();
    const road = new RoadIndex(scenario.map);
    const edge = [...road.edges.values()].find((e) => e.cells.length >= 2)!;
    const coordinator = AgentId.parse("coordinator");
    const ensemble = new ForecastService(coordinator, scenario.map).update(snapshotOf(coordinator, [briefingObservation(scenario.map)], 0), 0);
    const first = new Float64Array(64 * 64).fill(Infinity);
    const second = new Float64Array(64 * 64).fill(Infinity);
    first[edge.cells[0]!.cell] = 100;
    first[edge.cells[1]!.cell] = 900;
    second[edge.cells[0]!.cell] = 200;
    second[edge.cells[1]!.cell] = 800;
    const controlled = { ...ensemble, arrivalPaddingMs: 0, members: [
      { ...ensemble.members[0]!, ignitionMs: first },
      { ...ensemble.members[1]!, ignitionMs: second },
    ] };
    const band = edgeArrivalBands(controlled, road, 0).find((b) => b.edgeId === edge.id)!;
    expect(band.earliestIgnitionMs).toBe(100);
    expect(band.latestIgnitionMs).toBe(200);
    const invalid = { ...controlled, reliability: "unreliable" as const, members: [] };
    const view = toCoordinatorForecastView(invalid, road, 0, null)!;
    expect(view.explanation).toMatch(/not authorized/);
    expect(view.edgeArrivals.every((b) => b.earliestIgnitionMs === null && b.latestIgnitionMs === null)).toBe(true);
  });
});
