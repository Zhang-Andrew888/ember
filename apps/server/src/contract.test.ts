import { describe, expect, it } from "vitest";
import { buildSyntheticScenario } from "@ember/simulation";
import { IncidentSession } from "./session.js";
import { encodeServer, parseServerWire } from "./protocol.js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const fixtureDir = join(dirname(fileURLToPath(import.meta.url)), "../../../tests/fixtures");

describe("contract / private state leaks", () => {
  it("never puts seed or private parameters in coordinator views or wire envelopes", () => {
    const session = new IncidentSession({
      scenario: buildSyntheticScenario(),
      seed: "LEAK-TEST-SEED-XYZZY",
      uncontrolled: ["crew-1", "crew-2", "crew-3"],
    });
    session.runUntil(120_000);
    const view = session.coordinatorView();
    const blob = JSON.stringify(view);
    expect(blob).not.toContain("LEAK-TEST-SEED-XYZZY");
    expect(blob).not.toContain("spreadMultiplier");
    expect(blob).not.toContain("privateWorldParameters");
    const wire = encodeServer({ type: "view", view });
    expect(wire).not.toContain("LEAK-TEST-SEED-XYZZY");
    expect(parseServerWire(wire)?.type).toBe("view");
  });

  it("parses the recorded session fixture without private fields", () => {
    const lines = readFileSync(join(fixtureDir, "recorded-ws-session.jsonl"), "utf8")
      .trim()
      .split("\n")
      .filter(Boolean);
    for (const line of lines) {
      expect(line).not.toMatch(/privateWorldParameters|spreadMultiplier|"seed":/);
      const msg = parseServerWire(line);
      expect(msg).not.toBeNull();
    }
  });
});
