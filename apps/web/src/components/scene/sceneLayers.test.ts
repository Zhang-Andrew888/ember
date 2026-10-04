import { describe, expect, it } from "vitest";
import { CoordinatorView, NodeId } from "@ember/domain";
import { fixtureCoordinatorView } from "../../../../../tests/fixtures/coordinator-view.fixture.js";
import { adaptToScenarioIds } from "../../net/mockBase.js";
import { scenarioMap } from "../../map/activeScenario.js";
import { SCENE_SIZE, worldToScene } from "../../map/worldScale.js";
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

  describe("off-road legs", () => {
    const worldMeters = scenarioMap.worldMeters;
    const scale = SCENE_SIZE / worldMeters;
    const toWorld = (point: { x: number; z: number }) => ({ x: point.x / scale + worldMeters / 2, y: point.z / scale + worldMeters / 2 });
    const offroad = (start: { x: number; y: number }, end: { x: number; y: number }, departMs: number) => ({
      kind: "offroad" as const,
      start,
      end,
      departMs: departMs as never,
      arriveMs: (departMs + 10_000) as never,
      speedFactor: 0.5 as const,
    });

    it("draws an off-road-only plan instead of dropping it", () => {
      const plan = view.agentPlans[0]!;
      const lines = buildRouteLines(
        { ...view, agentPlans: [{ ...plan, legs: [], offroadLegs: [offroad({ x: 100, y: 100 }, { x: 300, y: 100 }, 0)] }] },
        scenarioMap,
        null,
      );
      expect(lines).toHaveLength(1);
      expect(lines[0]?.points).toEqual([worldToScene(100, 100, worldMeters), worldToScene(300, 100, worldMeters)]);
    });

    it("joins an off-road leg that starts where the road route ends, in departure order", () => {
      const plan = view.agentPlans[0]!;
      const [road] = buildRouteLines(view, scenarioMap, null);
      const roadEnd = toWorld(road!.points[road!.points.length - 1]!);
      const mid = { x: roadEnd.x + 50, y: roadEnd.y };
      const far = { x: roadEnd.x + 50, y: roadEnd.y + 80 };
      const lines = buildRouteLines(
        { ...view, agentPlans: [{ ...plan, offroadLegs: [offroad(mid, far, 20_000), offroad(roadEnd, mid, 10_000)] }] },
        scenarioMap,
        null,
      );
      expect(lines).toHaveLength(1);
      expect(lines[0]?.points).toHaveLength(road!.points.length + 2);
      const last = lines[0]!.points[lines[0]!.points.length - 1]!;
      expect(last.x).toBeCloseTo(worldToScene(far.x, far.y, worldMeters).x);
      expect(last.z).toBeCloseTo(worldToScene(far.x, far.y, worldMeters).z);
    });

    it("keeps a disconnected off-road leg separate and unlabelled rather than inventing a connection", () => {
      const plan = view.agentPlans[0]!;
      const lines = buildRouteLines(
        { ...view, agentPlans: [{ ...plan, offroadLegs: [offroad({ x: 1500, y: 1500 }, { x: 1550, y: 1500 }, 0)] }] },
        scenarioMap,
        null,
      );
      expect(lines).toHaveLength(2);
      expect(lines[0]?.labelled).toBe(true);
      expect(lines[1]?.labelled).toBe(false);
      expect(new Set(lines.map((line) => line.key)).size).toBe(2);
    });

    it("names the work type in the label when the plan reports it", () => {
      const plan = view.agentPlans[0]!;
      const suppress = buildRouteLines(
        { ...view, agentPlans: [{ ...plan, work: { kind: "suppress_fire", gridCellIndex: 42 } }] },
        scenarioMap,
        null,
      );
      expect(suppress[0]?.label).toBe("Crew 1 approaching (fire suppression)");
      const line = buildRouteLines(
        { ...view, agentPlans: [{ ...plan, work: { kind: "build_line", workNodeId: NodeId.parse("n-h"), start: { x: 800, y: 800 }, end: { x: 800, y: 1300 } } }] },
        scenarioMap,
        null,
      );
      expect(line[0]?.label).toBe("Crew 1 approaching (fire line construction)");
    });
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
