import { describe, it, expect } from "vitest";
import { CoordinatorView } from "@ember/domain";
import { emptyScenario, staleContradictionScenario, runEndedScenarios } from "./scenarios.js";

describe("net/scenarios - emptyScenario", () => {
  it("is schema-valid", () => {
    expect(() => CoordinatorView.parse(emptyScenario)).not.toThrow();
  });

  it("has no agents and no observed cells, but still has the public sites", () => {
    expect(emptyScenario.agents).toHaveLength(0);
    expect(emptyScenario.observedCells).toHaveLength(0);
    expect(emptyScenario.sites.length).toBeGreaterThan(0);
  });
});

describe("net/scenarios - staleContradictionScenario", () => {
  it("is schema-valid", () => {
    expect(() => CoordinatorView.parse(staleContradictionScenario)).not.toThrow();
  });

  it("contains two entries for the same edge+cellIndex with different burnState", () => {
    const [edgeId, cellIndex] = [
      staleContradictionScenario.observedCells[0]!.edgeId,
      staleContradictionScenario.observedCells[0]!.cellIndex,
    ];
    const matching = staleContradictionScenario.observedCells.filter(
      (cell) => cell.edgeId === edgeId && cell.cellIndex === cellIndex,
    );
    expect(matching.length).toBeGreaterThanOrEqual(2);
    expect(new Set(matching.map((cell) => cell.burnState)).size).toBeGreaterThan(1);
  });
});

describe("net/scenarios - runEndedScenarios", () => {
  it("is schema-valid for every EndReason", () => {
    for (const view of Object.values(runEndedScenarios)) {
      expect(() => CoordinatorView.parse(view)).not.toThrow();
    }
  });

  it("sets incidentStatus to ended and incidentEnd.displayReason to match the key", () => {
    for (const [reason, view] of Object.entries(runEndedScenarios)) {
      expect(view.incidentStatus).toBe("ended");
      expect(view.incidentEnd?.displayReason).toBe(reason);
    }
  });

  it("all_protection_crews_lost marks every protection crew lost but leaves the scout alive", () => {
    const view = runEndedScenarios.all_protection_crews_lost;
    const crews = view.agents.filter((a) => a.role === "protection_crew");
    const scouts = view.agents.filter((a) => a.role === "scout");
    expect(crews.length).toBeGreaterThan(0);
    expect(crews.every((a) => a.state === "lost")).toBe(true);
    expect(scouts.every((a) => a.state !== "lost")).toBe(true);
  });

  it("all_sites_resolved has no unresolved site", () => {
    const view = runEndedScenarios.all_sites_resolved;
    expect(view.sites.every((s) => s.observedDestroyed === true || (s.observedCompletedWork ?? 0) > 0)).toBe(
      true,
    );
  });

  it("fire_extinguished has no burning cell", () => {
    const view = runEndedScenarios.fire_extinguished;
    expect(view.observedCells.every((c) => c.burnState !== "burning")).toBe(true);
  });
});
