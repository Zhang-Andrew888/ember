import { describe, expect, it } from "vitest";
import { AgentId } from "@ember/domain";
import { patrolDirectionForAgent, patrolDirectionsForAgent, shouldSplitBrigadeLine, shouldYieldCell } from "./brigade.js";
import { GAME_CHANGES } from "@ember/simulation/model";

describe("patrol and brigade split", () => {
  it("gives different patrol headings per crew", () => {
    const a = patrolDirectionForAgent(AgentId.parse("crew-1"));
    const b = patrolDirectionForAgent(AgentId.parse("crew-2"));
    expect(a).not.toBe(b);
  });

  it("only splits the line when multiple burn cells are known", () => {
    expect(shouldSplitBrigadeLine(1, GAME_CHANGES.brigadeSplitMinBurnCells)).toBe(false);
    expect(shouldSplitBrigadeLine(2, GAME_CHANGES.brigadeSplitMinBurnCells)).toBe(true);
  });

  it("rotates through every heading, starting from the crew's own, with a new lead each round", () => {
    const crew = AgentId.parse("crew-1");
    const round0 = patrolDirectionsForAgent(crew, 0);
    const round1 = patrolDirectionsForAgent(crew, 1);
    expect(round0[0]).toBe(patrolDirectionForAgent(crew));
    expect(new Set(round0).size).toBe(8);
    expect(new Set(round1).size).toBe(8);
    expect(round1[0]).not.toBe(round0[0]);
  });

  it("lets exactly one of two crews on the same cell move on", () => {
    const a = AgentId.parse("crew-1");
    const b = AgentId.parse("crew-2");
    expect(shouldYieldCell(a, [b])).toBe(false);
    expect(shouldYieldCell(b, [a])).toBe(true);
    expect(shouldYieldCell(a, [])).toBe(false);
  });
});
