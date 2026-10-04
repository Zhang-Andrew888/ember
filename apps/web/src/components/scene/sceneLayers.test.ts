import { describe, expect, it } from "vitest";
import { CoordinatorView } from "@ember/domain";
import { fixtureCoordinatorView } from "../../../../../tests/fixtures/coordinator-view.fixture.js";
import { adaptToScenarioIds } from "../../net/mockBase.js";
import { scenarioMap } from "../../map/activeScenario.js";
import { type ForecastBand, bandWidthForSpread, buildForecastLayer, buildRouteLines, humanizeReason, labelledBands, MAX_FORECAST_LABELS } from "./sceneLayers.js";

const view = CoordinatorView.parse(adaptToScenarioIds(fixtureCoordinatorView));

describe("buildRouteLines", () => {
  it("builds a polyline from the fixture plan, oriented by leg direction", () => {
    const [line] = buildRouteLines(view, scenarioMap, null);
    expect(line?.agentId).toBe("crew-1");
    expect(line?.phase).toBe("approach");
    // rw -> j1 -> s -> h -> sa, in scene units (see map/worldScale.ts).
    expect(line?.points).toHaveLength(5);
    expect(line?.points[0]).toEqual({ x: -612.5, z: 0 });
    expect(line?.points[1]).toEqual({ x: -350, z: 0 });
    expect(line?.label).toBe("Crew 1 approaching");
  });

  it("reverses points for a reverse leg", () => {
    const plan = view.agentPlans[0]!;
    const reversed: CoordinatorView = {
      ...view,
      agentPlans: [{ ...plan, legs: [{ ...plan.legs[0]!, direction: "reverse" }] }],
    };
    const [line] = buildRouteLines(reversed, scenarioMap, null);
    expect(line?.points[0]).toEqual({ x: -350, z: 0 });
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

describe("stale plans", () => {
  it.each(["working", "lost", "idle", "retreating"] as const)("does not label a %s crew approaching", (state) => {
    const changed = { ...view, agents: view.agents.map((agent) => agent.id === "crew-1" ? { ...agent, state } : agent) };
    expect(buildRouteLines(changed, scenarioMap, null)).toEqual([]);
  });
});

describe("buildForecastLayer", () => {
  it("is null before the first forecast build", () => {
    expect(buildForecastLayer({ ...view, coordinatorForecast: null }, scenarioMap)).toBeNull();
  });

  it("labels arrival windows in simulated time and encodes spread as width", () => {
    const layer = buildForecastLayer(view, scenarioMap)!;
    expect(layer.trusted).toBe(true);
    const band = layer.bands[0]!;
    expect(band.label).toBe("fire may reach 2:30–5:30 (simulated time)");
    expect(band.spreadMs).toBe(180_000);
    expect(band.widthUnits).toBe(bandWidthForSpread(180_000));
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

describe("forecast incident bounds", () => {
  const withWindow = (earliestIgnitionMs: number, latestIgnitionMs: number): CoordinatorView => CoordinatorView.parse({
    ...view, coordinatorForecast: { ...view.coordinatorForecast!, edgeArrivals: [
      { ...view.coordinatorForecast!.edgeArrivals[0]!, earliestIgnitionMs, latestIgnitionMs },
    ] },
  });
  it("clips the display window without claiming that later arrival is impossible", () => {
    const band = buildForecastLayer(withWindow(1_200_000, 3_000_000), scenarioMap)!.bands[0]!;
    expect(band.label).toContain("20:00–25:00");
    expect(band.label).toContain("window continues beyond incident");
    expect(band.latestMs).toBe(1_500_000);
    expect(band.spreadMs).toBe(1_800_000);
  });
  it("omits windows entirely outside the incident", () => {
    expect(buildForecastLayer(withWindow(1_500_000, 3_000_000), scenarioMap)!.bands).toEqual([]);
  });
  it("hides the forecast when the incident ends, including early endings", () => {
    expect(buildForecastLayer({ ...view, simTimeMs: 1_500_000 as never }, scenarioMap)).toBeNull();
    const ended = CoordinatorView.parse({ ...view, incidentEnd: {
      tick: 1, wallElapsedMs: 1000, matchingReasons: ["fire_extinguished"], displayReason: "fire_extinguished", finalSnapshotHash: "ended",
    } });
    expect(buildForecastLayer(ended, scenarioMap)).toBeNull();
  });
});

describe("labelledBands", () => {
  const band = (id: string, earliestMs: number | null, latestMs: number | null = null): ForecastBand => ({
    key: id,
    edgeId: id,
    points: [],
    earliestMs,
    latestMs,
    spreadMs: null,
    widthUnits: 6,
    label: id,
  });

  it("labels only the soonest few, soonest first", () => {
    const bands = [band("late", 900_000), band("soon", 100_000), band("mid", 400_000), band("later", 600_000), band("sooner", 50_000)];
    expect(labelledBands(bands).map((b) => b.edgeId)).toEqual(["sooner", "soon", "mid"]);
    expect(labelledBands(bands)).toHaveLength(MAX_FORECAST_LABELS);
  });

  it("bands with no modeled arrival sort last, and nothing is dropped when there are few", () => {
    const bands = [band("none", null), band("a", 5000)];
    expect(labelledBands(bands).map((b) => b.edgeId)).toEqual(["a", "none"]);
  });

  it("does not mutate its input", () => {
    const bands = [band("b", 2), band("a", 1)];
    labelledBands(bands);
    expect(bands.map((b) => b.edgeId)).toEqual(["b", "a"]);
  });
});

describe("humanizeReason", () => {
  it("turns machine reasons into words", () => {
    expect(humanizeReason("work_interval_limited_by_forecast")).toBe("work window limited by forecast");
    expect(humanizeReason("single-capacity")).toBe("single capacity");
  });
});
