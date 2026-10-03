import { buildSyntheticScenario } from "@ember/simulation";
import { describe, expect, it } from "vitest";
import { checkScenarioText } from "./check-scenario.js";

describe("checkScenarioText", () => {
  it("accepts the synthetic scenario with every gate ok", () => {
    const r = checkScenarioText(JSON.stringify(buildSyntheticScenario()));
    expect(r.ok).toBe(true);
    expect(r.lines.filter((l) => l.startsWith("ok  ")).length).toBe(5);
  });

  it("reports invalid JSON and schema failures", () => {
    expect(checkScenarioText("{not json").ok).toBe(false);
    const r = checkScenarioText(JSON.stringify({ scenarioId: "x" }));
    expect(r.ok).toBe(false);
    expect(r.lines[0]).toBe("schema: FAIL");
  });

  it("reports structural errors such as a dangling reference", () => {
    const broken = JSON.parse(JSON.stringify(buildSyntheticScenario())) as {
      map: { edges: { from: string }[] };
    };
    const first = broken.map.edges[0];
    if (first === undefined) throw new Error("synthetic scenario has no edges");
    first.from = "node-that-does-not-exist";
    const r = checkScenarioText(JSON.stringify(broken));
    expect(r.ok).toBe(false);
    expect(r.lines[0]).toBe("structure: FAIL");
  });
});
