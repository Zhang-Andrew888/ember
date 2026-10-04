import { describe, expect, it } from "vitest";
import { AgentId } from "@ember/domain";
import { CallsignDirectory, callsignTokens, defaultCallsign } from "./callsigns.js";

const id = (s: string) => AgentId.parse(s);
const dir = new CallsignDirectory([
  { agentId: id("crew-1"), callsign: "Crew 1" },
  { agentId: id("crew-2"), callsign: "Crew 2" },
  { agentId: id("crew-10"), callsign: "Crew 10" },
  { agentId: id("lookout"), callsign: "Lookout" },
]);

describe("callsign tokens and defaults", () => {
  it("normalizes case, punctuation and number words", () => {
    expect(callsignTokens("Crew-Two")).toEqual(["crew", "2"]);
    expect(callsignTokens("  CREW   2! ")).toEqual(["crew", "2"]);
    expect(callsignTokens("")).toEqual([]);
  });

  it("derives the documented fictional callsigns from authored ids", () => {
    expect(defaultCallsign("crew-1")).toBe("Crew 1");
    expect(defaultCallsign("crew-3")).toBe("Crew 3");
    expect(defaultCallsign("ridge-lead")).toBe("Ridge Lead");
  });
});

describe("named-recipient resolution always resolves", () => {
  it.each(["Crew 2", "crew 2", "crew two", "Crew-2", "CREW TWO", "2 crew"])("matches %s to crew 2", (heard) => {
    expect(dir.resolve(heard)).toMatchObject({ kind: "match", agentId: "crew-2", callsign: "Crew 2" });
  });

  it("matches a one-word callsign by name, and a distinctive part of a name", () => {
    expect(dir.resolve("lookout")).toMatchObject({ kind: "match", agentId: "lookout" });
    expect(dir.resolve("the lookout")).toMatchObject({ kind: "match", agentId: "lookout" });
    expect(dir.resolve("please")).toMatchObject({ kind: "unknown" });
  });

  it("does not confuse Crew 1 with Crew 10", () => {
    expect(dir.resolve("crew one")).toMatchObject({ kind: "match", agentId: "crew-1" });
    expect(dir.resolve("crew ten")).toMatchObject({ kind: "match", agentId: "crew-10" });
  });

  it("is ambiguous when a name fits several, with sorted candidates", () => {
    const r = dir.resolve("crew");
    expect(r.kind).toBe("ambiguous");
    if (r.kind === "ambiguous") expect(r.candidates.map((c) => c.callsign)).toEqual(["Crew 1", "Crew 10", "Crew 2"]);
    // A bare number is unambiguous only when exactly one callsign carries it.
    expect(dir.resolve("1")).toMatchObject({ kind: "match", agentId: "crew-1" });
  });

  it("is unknown for names that match nobody, and for empty or punctuation-only input", () => {
    expect(dir.resolve("Crew 7")).toMatchObject({ kind: "unknown", heard: "Crew 7" });
    expect(dir.resolve("helicopter")).toMatchObject({ kind: "unknown" });
    expect(dir.resolve("")).toMatchObject({ kind: "unknown" });
    expect(dir.resolve("???")).toMatchObject({ kind: "unknown" });
  });

  it("never silently picks between identical callsigns", () => {
    const twin = new CallsignDirectory([
      { agentId: id("a"), callsign: "Alpha" },
      { agentId: id("b"), callsign: "alpha" },
    ]);
    const r = twin.resolve("Alpha");
    expect(r.kind).toBe("ambiguous");
  });

  it("is deterministic regardless of directory order", () => {
    const shuffled = new CallsignDirectory([
      { agentId: id("lookout"), callsign: "Lookout" },
      { agentId: id("crew-10"), callsign: "Crew 10" },
      { agentId: id("crew-2"), callsign: "Crew 2" },
      { agentId: id("crew-1"), callsign: "Crew 1" },
    ]);
    for (const heard of ["crew", "Crew 2", "lookout", "nobody"]) expect(shuffled.resolve(heard)).toEqual(dir.resolve(heard));
  });

  it("an empty directory resolves everything as unknown", () => {
    expect(new CallsignDirectory([]).resolve("Crew 1").kind).toBe("unknown");
  });

  it("never throws on odd input", () => {
    for (const heard of ["\u0000", "😀", "a".repeat(5000), "crew\n2"]) expect(() => dir.resolve(heard)).not.toThrow();
    expect(dir.resolve("crew\n2")).toMatchObject({ kind: "match", agentId: "crew-2" });
  });

  it("offers a clarification for ambiguous and unknown names only", () => {
    expect(dir.clarification(dir.resolve("Crew 2"))).toBeNull();
    expect(dir.clarification(dir.resolve("crew"))).toBe("Which do you mean: Crew 1 or Crew 10 or Crew 2?");
    expect(dir.clarification(dir.resolve("Crew 7"))).toMatch(/Known callsigns: Crew 1, Crew 10, Crew 2, Lookout/);
  });

  it("explains plainly that there is no scout when one is asked for (#117)", () => {
    expect(dir.resolve("scout").kind).toBe("unknown");
    expect(dir.clarification(dir.resolve("the scout"))).toMatch(/There is no scout in this incident\. Known callsigns: Crew 1/);
    expect(dir.clarification(dir.resolve("Crew 7"))).not.toMatch(/scout/i);
  });
});
