import { describe, expect, it } from "vitest";
import { AgentId } from "@ember/domain";
import { Incident } from "./incident.js";
import { buildSyntheticScenario } from "./scenario.js";
import { cellCenter, cellIndexOf } from "./model/index.js";

const crew1 = AgentId.parse("crew-1");
const calm = { spreadMultiplier: 0.3, windShiftMs: 1e9, initialWindRad: 0 };

/** A crew standing idle at its start node with one fire cell `dx`,`dy` meters away. */
function crewBesideFire(dx: number, dy: number) {
  const base = buildSyntheticScenario({ agents: ["crew-1"], sites: ["site-a"], gameChanges: true });
  const start = base.map.nodes.find((n) => n.id === base.agents[0]!.startNodeId)!;
  const fire = cellIndexOf(start.x + dx, start.y + dy)!;
  const scenario = { ...base, map: { ...base.map, initialFireCells: [fire] } };
  return { inc: new Incident({ scenario, seed: "hose-spray", overrides: calm }), start, fire };
}

describe("game-changes hose spray", () => {
  it("turns an idle crew toward fire in reach and sprays it out", () => {
    const { inc, fire } = crewBesideFire(-90, 0);
    inc.advanceTo(1000);
    expect(inc.projectCoordinator().agents.find((a) => a.id === crew1)?.hose).toBeDefined();
    let out = false;
    for (let t = 2000; t <= 60_000 && !out; t += 1000) {
      inc.advanceTo(t);
      out = !inc.projectCoordinator().currentFire?.burningCells.includes(fire);
    }
    expect(out).toBe(true);
    expect(inc.projectAgent(crew1).state).not.toBe("lost");
  });

  it("reports the hose only while burning fire in reach lies inside its 180° spray", () => {
    const { inc, start } = crewBesideFire(0, 100);
    let sawHose = false;
    for (let t = 1000; t <= 60_000; t += 1000) {
      inc.advanceTo(t);
      const view = inc.projectCoordinator();
      const hose = view.agents.find((a) => a.id === crew1)?.hose;
      if (hose === undefined) continue;
      sawHose = true;
      const inSpray = (view.currentFire?.burningCells ?? []).some((cell) => {
        const c = cellCenter(cell);
        const d = Math.hypot(c.x - start.x, c.y - start.y);
        return d <= 125 && ((c.x - start.x) * hose.dx + (c.y - start.y) * hose.dy) / d >= -1e-9;
      });
      expect(inSpray).toBe(true);
    }
    expect(sawHose).toBe(true);
  });

  it("leaves fire beyond hose reach alone", () => {
    const { inc } = crewBesideFire(0, 300);
    inc.advanceTo(5000);
    expect(inc.projectCoordinator().agents.find((a) => a.id === crew1)?.hose).toBeUndefined();
  });
});
