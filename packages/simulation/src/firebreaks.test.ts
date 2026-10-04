import { describe, expect, it } from "vitest";
import {
  Incident,
  SIM_DEFAULTS,
  World,
  buildSyntheticScenario,
  derivePrivateParameters,
  firebreakPresetCells,
  isFirebreakPreset,
  validateScenario,
  withFirebreaks,
} from "./index.js";
import { CELL_BURNED, CELL_BURNING, CELL_NONBURNABLE } from "./model/index.js";

const base = buildSyntheticScenario();
const headLine = firebreakPresetCells(base, "head-line");

function burnedAtHorizon(world: World): number {
  while (world.timeMs < SIM_DEFAULTS.incidentHorizonMs) world.step();
  let burned = 0;
  for (const s of world.fire.state) if (s === CELL_BURNED || s === CELL_BURNING) burned++;
  return burned;
}

describe("firebreak presets", () => {
  it("lays out the Phase 0 lines, sorted and unique", () => {
    const ring = firebreakPresetCells(base, "ridge-ring");
    expect(headLine).toHaveLength(40);
    expect(ring).toHaveLength(16);
    expect(firebreakPresetCells(base, "both")).toHaveLength(56);
    for (const cells of [headLine, ring]) expect(cells).toEqual([...cells].sort((a, b) => a - b));
  });

  it("recognises preset names", () => {
    expect(isFirebreakPreset("head-line")).toBe(true);
    expect(isFirebreakPreset("moat")).toBe(false);
  });

  it("merges into the map without duplicating cells", () => {
    const once = withFirebreaks(base, headLine);
    expect(withFirebreaks(once, headLine).map.firebreakCells).toEqual(headLine);
    expect(base.map.firebreakCells).toBeUndefined();
    expect(validateScenario(once)).toEqual([]);
  });

  it("rejects a firebreak on the initial fire", () => {
    const bad = withFirebreaks(base, [base.map.initialFireCells[0]!]);
    expect(validateScenario(bad).join(" ")).toMatch(/is a firebreak cell/);
  });
});

describe("firebreaks in the world", () => {
  it("never ignite and hold back the fire", () => {
    const params = derivePrivateParameters("showcase");
    const world = new World(withFirebreaks(base, headLine), params);
    for (const cell of headLine) expect(world.fire.state[cell]).toBe(CELL_NONBURNABLE);
    const withBreak = burnedAtHorizon(world);
    for (const cell of headLine) expect(world.fire.state[cell]).toBe(CELL_NONBURNABLE);
    expect(withBreak).toBeLessThan(burnedAtHorizon(new World(base, params)));
  });

  it("reach the coordinator view only when present", () => {
    const plain = new Incident({ scenario: base, seed: "showcase" });
    expect(plain.projectCoordinator().firebreakCells).toBeUndefined();
    const broken = new Incident({ scenario: withFirebreaks(base, headLine), seed: "showcase" });
    expect(broken.projectCoordinator().firebreakCells).toEqual(headLine);
  });
});
