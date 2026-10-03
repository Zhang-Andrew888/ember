import { describe, it, expect } from "vitest";
import { resolveScenario, SCENARIO_NAMES } from "./scenarioSelection.js";

describe("net/scenarioSelection - resolveScenario", () => {
  it("returns null when there is no scenario query param", () => {
    expect(resolveScenario("")).toBeNull();
    expect(resolveScenario("?foo=bar")).toBeNull();
  });

  it("returns null for an unrecognized scenario value (never silently guesses)", () => {
    expect(resolveScenario("?scenario=not-a-real-one")).toBeNull();
  });

  it("resolves every declared scenario name to non-null options", () => {
    for (const name of SCENARIO_NAMES) {
      expect(resolveScenario(`?scenario=${name}`)).not.toBeNull();
    }
  });

  it("maps content scenarios to a single-snapshot playback", () => {
    const options = resolveScenario("?scenario=empty");
    expect(options?.snapshots).toHaveLength(1);
  });

  it("maps ends-while-active to a two-snapshot timed sequence, the only scenario that isn't already ended on arrival", () => {
    const options = resolveScenario("?scenario=ends-while-active");
    expect(options?.snapshots).toHaveLength(2);
    expect(options?.snapshots?.[0]?.incidentEnd).toBeNull();
    expect(options?.snapshots?.[1]?.incidentEnd).not.toBeNull();
    expect(options?.intervalMs).toBeGreaterThan(0);
  });

  it("maps connection-error to failToOpen", () => {
    expect(resolveScenario("?scenario=connection-error")).toEqual({ failToOpen: true });
  });

  it("maps disconnect to a disconnectAfterMs option", () => {
    const options = resolveScenario("?scenario=disconnect");
    expect(options?.disconnectAfterMs).toBeGreaterThan(0);
  });

  it("works alongside other query params", () => {
    expect(resolveScenario("?foo=bar&scenario=empty&baz=qux")).not.toBeNull();
  });
});
