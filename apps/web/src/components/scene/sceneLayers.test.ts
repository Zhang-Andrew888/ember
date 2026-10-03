import { describe, expect, it } from "vitest";
import { CoordinatorView } from "@ember/domain";
import { fixtureCoordinatorView } from "../../../../../tests/fixtures/coordinator-view.fixture.js";
import { scenarioMap } from "../../map/scenarioMap.js";
import { bandWidthForSpread, buildForecastLayer, buildRouteLines } from "./sceneLayers.js";

const view = CoordinatorView.parse(fixtureCoordinatorView);

describe("buildRouteLines", () => {
  it("builds a polyline from the fixture plan, oriented by leg direction", () => {
    const [line] = buildRouteLines(view, scenarioMap, null);
    expect(line?.agentId).toBe("crew-1");
    expect(line?.phase).toBe("approach");
    expect(line?.points).toHaveLength(2);
    expect(line?.points[0]).toEqual({ x: -260, z: 20 });
    expect(line?.points[1]).toEqual({ x: 180, z: 60 });
    expect(line?.label).toBe("Crew 1 approaching");
  });

  it("reverses points for a reverse leg", () => {
    const plan = view.agentPlans[0]!;
    const reversed: CoordinatorView = {
      ...view,
      agentPlans: [{ ...plan, legs: [{ ...plan.legs[0]!, direction: "reverse" }] }],
    };
    const [line] = buildRouteLines(reversed, scenarioMap, null);
    expect(line?.points[0]).toEqual({ x: 180, z: 60 });
  });

  it("marks the selected agent's line as selected", () => {
    expect(buildRouteLines(view, scenarioMap, "crew-1")[0]?.selected).toBe(true);
    expect(buildRouteLines(view, scenarioMap, "scout")[0]?.selected).toBe(false);
  });

  it("skips legs on unknown edges instead of drawing at a fallback", () => {
    const plan = view.agentPlans[0]!;
    const unknown: CoordinatorView = {
      ...view,
      agentPlans: [{ ...plan, legs: [{ edgeId: "nope" as never, direction: "forward" }] }],
    };
    expect(buildRouteLines(unknown, scenarioMap, null)).toEqual([]);
  });

  it("returns nothing when there are no plans", () => {
    expect(buildRouteLines({ ...view, agentPlans: [] }, scenarioMap, null)).toEqual([]);
  });
});

describe("buildForecastLayer", () => {
  it("is null before the first forecast build", () => {
    expect(buildForecastLayer({ ...view, coordinatorForecast: null }, scenarioMap)).toBeNull();
  });

  it("labels arrival windows in incident time and encodes spread as width", () => {
    const layer = buildForecastLayer(view, scenarioMap)!;
    expect(layer.trusted).toBe(true);
    const band = layer.bands[0]!;
    expect(band.label).toBe("fire may reach 10:00–15:00 (incident time)");
    expect(band.spreadMs).toBe(300_000);
    expect(band.widthUnits).toBe(bandWidthForSpread(300_000));
  });

  it("wider uncertainty draws a wider ribbon, bounded", () => {
    expect(bandWidthForSpread(0)).toBeLessThan(bandWidthForSpread(150_000));
    expect(bandWidthForSpread(150_000)).toBeLessThan(bandWidthForSpread(300_000));
    expect(bandWidthForSpread(9_999_999)).toBe(bandWidthForSpread(300_000));
    expect(bandWidthForSpread(null)).toBe(bandWidthForSpread(0));
  });

  it("does not trust unreliable or rebuilding forecasts", () => {
    const base = view.coordinatorForecast!;
    for (const reliability of ["unreliable", "rebuilding"] as const) {
      const layer = buildForecastLayer(
        { ...view, coordinatorForecast: { ...base, reliability, supportedMemberCount: 0 } },
        scenarioMap,
      )!;
      expect(layer.trusted).toBe(false);
      expect(layer.headline.toLowerCase()).toContain(reliability === "unreliable" ? "unreliable" : "rebuilding");
    }
  });

  it("says so when no arrival is modeled, rather than implying safety with a blank", () => {
    const base = view.coordinatorForecast!;
    const layer = buildForecastLayer(
      {
        ...view,
        coordinatorForecast: {
          ...base,
          edgeArrivals: [{ ...base.edgeArrivals[0]!, earliestIgnitionMs: null, latestIgnitionMs: null }],
        },
      },
      scenarioMap,
    )!;
    expect(layer.bands[0]?.label).toBe("no modeled fire arrival");
  });
});
