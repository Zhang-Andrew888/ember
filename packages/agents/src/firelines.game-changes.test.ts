import { describe, expect, it, vi } from "vitest";
import { AgentId, Objective, ObjectiveId, SequenceNumber, type MapPoint } from "@ember/domain";
import { Incident, buildSyntheticScenario } from "@ember/simulation";
import { cellCenter, cellIndexOf, firelineCells } from "@ember/simulation/model";
import { CrewController, runControllers } from "./index.js";

// Full simulated runs are slow on shared CI machines.
vi.setConfig({ testTimeout: 120_000 });

const crew1 = AgentId.parse("crew-1");
const calm = { spreadMultiplier: 0.6, windShiftMs: 1e9, initialWindRad: 0 };

function run(start: MapPoint, end: MapPoint, untilMs: number) {
  const base = buildSyntheticScenario({ agents: ["crew-1"], sites: ["site-a"], gameChanges: true });
  const scenario = { ...base, map: { ...base.map, initialFireCells: [cellIndexOf(1300, 300)!] } };
  const inc = new Incident({ scenario, seed: "gc-line", overrides: calm });
  const c = new CrewController({ agentId: crew1, callsign: "Crew 1", role: "protection_crew", map: scenario.map, gameChanges: true });
  c.receiveObjective(
    Objective.parse({
      id: ObjectiveId.parse("obj-line"),
      recipientId: crew1,
      kind: "build_line",
      targetId: null,
      constraints: { line: { start, end } },
      issueSequence: SequenceNumber.parse(1),
    }),
  );
  const log = runControllers(inc, [c], untilMs);
  return { inc, log };
}

describe("game-changes fire line orders", () => {
  it("drives off-road to a line far from any road and cuts it on foot", () => {
    const start = { x: 600, y: 1000 };
    const end = { x: 800, y: 1000 };
    const { inc, log } = run(start, end, 600_000);
    expect(log.decisions.find((d) => d.event.reasonCode === "objective_accepted")).toBeDefined();
    const built = new Set(inc.projectCoordinator().firebreakCells ?? []);
    for (const cell of firelineCells(start, end)) expect(built.has(cell)).toBe(true);
    expect(inc.projectAgent(crew1).state).not.toBe("lost");
  });

  it("walks along the line instead of working from the road node", () => {
    const start = { x: 400, y: 800 };
    const end = { x: 400, y: 1100 };
    const { inc } = run(start, end, 200_000);
    const position = inc.projectAgent(crew1).position;
    expect(position.kind).toBe("offroad");
    if (position.kind !== "offroad") return;
    const at = { x: position.start.x + (position.end.x - position.start.x) * position.progress, y: position.start.y + (position.end.y - position.start.y) * position.progress };
    const nearest = Math.min(...firelineCells(start, end).map((cell) => Math.hypot(cellCenter(cell).x - at.x, cellCenter(cell).y - at.y)));
    expect(nearest).toBeLessThan(40);
    expect(at.y).toBeGreaterThan(850);
  });
});
