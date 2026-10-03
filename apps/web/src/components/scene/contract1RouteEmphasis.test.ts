import { describe, expect, it } from "vitest";
import { CoordinatorView } from "@ember/domain";
import { fixtureCoordinatorView } from "../../../../../tests/fixtures/coordinator-view.fixture.js";
import { scenarioMap } from "../../map/activeScenario.js";
import { adaptToScenarioIds } from "../../net/mockBase.js";
import { buildSceneEntities } from "./sceneEntities.js";
import { buildRouteLines } from "./sceneLayers.js";

const view = CoordinatorView.parse(adaptToScenarioIds(fixtureCoordinatorView));

const TRUTH_KEYS = ["privateWorldParameters", "truthFire", "seed", "spreadMultiplier"] as const;

function allKeys(value: unknown, out = new Set<string>()): Set<string> {
  if (value === null || typeof value !== "object") return out;
  if (Array.isArray(value)) {
    for (const item of value) allKeys(item, out);
    return out;
  }
  for (const [key, nested] of Object.entries(value)) {
    out.add(key);
    allKeys(nested, out);
  }
  return out;
}

describe("contract #1 — route emphasis from agentPlans", () => {
  it("builds route and forecast scene entities from the shared fixture", () => {
    const entities = buildSceneEntities(view, scenarioMap);
    expect(entities.routes.length).toBeGreaterThan(0);
    expect(entities.forecast).not.toBeNull();
    expect(entities.routes[0]?.label).toMatch(/approaching|working|returning/);
  });

  it("never carries truth or private keys on route/forecast payloads derived from the view", () => {
    const entities = buildSceneEntities(view, scenarioMap);
    const keys = allKeys({ routes: entities.routes, forecast: entities.forecast });
    for (const forbidden of TRUTH_KEYS) {
      expect(keys.has(forbidden), forbidden).toBe(false);
    }
  });

  it("shows a route change when plan leg direction reverses (Slice 6 map story)", () => {
    const plan = view.agentPlans[0]!;
    const forward = buildRouteLines(view, scenarioMap, null)[0]?.points;
    const reversed = buildRouteLines(
      {
        ...view,
        agentPlans: [{ ...plan, legs: [{ ...plan.legs[0]!, direction: "reverse" }] }],
      },
      scenarioMap,
      null,
    )[0]?.points;
    expect(forward?.length).toBeGreaterThan(1);
    expect(reversed?.length).toBeGreaterThan(1);
    expect(forward![0]).not.toEqual(reversed![0]);
  });
});
