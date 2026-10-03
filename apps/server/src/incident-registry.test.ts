import { describe, expect, it } from "vitest";
import { IncidentRegistry } from "./incident-registry.js";

const clock = { nowMs: () => 0 };

describe("IncidentRegistry.create", () => {
  it("uses a random seed independent of the public incident id", () => {
    const registry = new IncidentRegistry();
    const record = registry.create({}, clock);
    expect(record.seed).not.toBe(`incident-${record.id}`);
    expect(record.seed).not.toContain(record.id);
    expect(record.seed).toMatch(/^[0-9a-f]{32}$/);
  });
});
