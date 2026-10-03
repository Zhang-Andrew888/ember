import type { CoordinatorView } from "@ember/domain";

/**
 * The shared fixture (tests/fixtures/coordinator-view.fixture.ts) is frozen
 * and keyed to "placeholder-*" ids and an old coordinate frame. The scene now
 * renders the real scenario topology (map/activeScenario.ts), so every mock
 * CoordinatorView passes through this adapter on its way into the app. It is
 * data-only: ids are remapped, and the plan/forecast/observed-cell content is
 * authored against the scenario's roads so it lines up on the map.
 */
const NODE_IDS: Readonly<Record<string, string>> = {
  "placeholder-node-refuge-west": "n-rw",
  "placeholder-node-refuge-south": "n-rs",
  "placeholder-node-site-a": "n-sa",
  "placeholder-node-site-b": "n-sb",
  "placeholder-node-site-c": "n-sc",
};

const EDGES: Readonly<Record<string, { id: string; offset: number }>> = {
  "placeholder-edge-refuge-west-site-a": { id: "e-j1-s", offset: 0 },
  "placeholder-edge-refuge-south-north-sector": { id: "e-rs-s", offset: 0 },
  "placeholder-edge-north-spread-1": { id: "e-rs-s", offset: 100 },
};

/** Fixture grid cells -> cells near the scenario's briefed ignition patch (grid 9..11, 44..45). */
const CELLS: Readonly<Record<number, number>> = {
  1100: 2825,
  1101: 2826,
  1164: 2889,
  1165: 2890,
  1203: 2891,
  1180: 2827,
};

const SYNTHETIC_PLAN_LEGS: CoordinatorView["agentPlans"][number]["legs"] = [
  { edgeId: "e-rw-j1" as never, direction: "forward" },
  { edgeId: "e-j1-s" as never, direction: "forward" },
  { edgeId: "e-s-h" as never, direction: "forward" },
  { edgeId: "e-h-sa" as never, direction: "forward" },
];

export function adaptToScenarioIds(view: CoordinatorView): CoordinatorView {
  const remapped = JSON.parse(JSON.stringify(view), (key: string, value: unknown) => {
    if (typeof value === "string") return NODE_IDS[value] ?? EDGES[value]?.id ?? value;
    if (key === "gridCellIndex" && typeof value === "number") return CELLS[value] ?? value;
    return value;
  }) as CoordinatorView;

  const agents = remapped.agents.map((agent, index) => {
    const original = view.agents[index]!;
    if (agent.position.kind !== "edge" || original.position.kind !== "edge") return agent;
    const offset = EDGES[original.position.edgeId]?.offset ?? 0;
    return {
      ...agent,
      position: {
        ...agent.position,
        distanceAlongPolyline: ((original.position.distanceAlongPolyline as number) + offset) as never,
      },
    };
  });

  const agentPlans = view.agentPlans.map((plan) => ({
    ...plan,
    legs: SYNTHETIC_PLAN_LEGS,
    refugeId: "n-rw" as never,
  }));

  const coordinatorForecast = view.coordinatorForecast
    ? {
        ...view.coordinatorForecast,
        edgeArrivals: [
          { edgeId: "e-j1-n" as never, earliestIgnitionMs: 150_000 as never, latestIgnitionMs: 330_000 as never },
          { edgeId: "e-n-h" as never, earliestIgnitionMs: 300_000 as never, latestIgnitionMs: 600_000 as never },
          { edgeId: "e-h-sa" as never, earliestIgnitionMs: 600_000 as never, latestIgnitionMs: 900_000 as never },
        ],
      }
    : null;

  return { ...remapped, agents, agentPlans: agentPlans.length ? agentPlans : remapped.agentPlans, coordinatorForecast };
}
