import { describe, expect, it, vi } from "vitest";
import { AgentId, NodeId, SiteId } from "@ember/domain";
import { Incident, authoredCommit, buildSyntheticScenario, recordOf } from "@ember/simulation";
import { RoadIndex } from "@ember/simulation/model";
import { parseRunRecord, serializeRunRecord, verifyRunRecord } from "./index.js";

// Full simulated runs and cold forecast rollouts are slow on shared CI machines.
vi.setConfig({ testTimeout: 120_000 });

function playedIncident(): Incident {
  const incident = new Incident({ scenario: buildSyntheticScenario(), seed: "saved-run" });
  incident.submit(
    authoredCommit({
      road: new RoadIndex(incident.scenario.map),
      agentId: AgentId.parse("crew-1"),
      planId: "p1",
      knowledgeRevision: incident.agentRevision(AgentId.parse("crew-1")),
      startNode: NodeId.parse("n-rw"),
      departMs: 0,
      approach: ["e-rw-j1", "e-j1-s", "e-s-h", "e-h-sa"],
      workSiteId: SiteId.parse("site-a"),
      workMs: 90_000,
      back: ["e-h-sa", "e-s-h", "e-j1-s", "e-rw-j1"],
    }),
  );
  incident.advanceTo(800_000);
  return incident;
}

describe("run record persistence", () => {
  it("round-trips through text and replays to the identical final snapshot", () => {
    const original = playedIncident();
    const text = serializeRunRecord(recordOf(original));
    const verified = verifyRunRecord(text);
    expect(verified.hashMatches).toBe(true);
    expect(verified.firstDivergenceMs).toBeNull();
    expect(verified.incident.snapshotHash()).toBe(original.snapshotHash());
    expect(verified.record.inputs).toHaveLength(1);
    expect(verified.record.seed).toBe("saved-run");
  });

  it("serializes identically for identical runs", () => {
    expect(serializeRunRecord(recordOf(playedIncident()))).toBe(serializeRunRecord(recordOf(playedIncident())));
  });

  it("detects an edited input log", () => {
    const text = serializeRunRecord(recordOf(playedIncident()));
    const edited = parseRunRecord(text);
    const first = edited.inputs[0];
    if (first === undefined || first.input.kind !== "commit_plan") throw new Error("expected a commit input");
    const changed = {
      ...edited,
      inputs: [{ ...first, appliedAtMs: first.appliedAtMs + 30_000 }],
    };
    const verified = verifyRunRecord(JSON.stringify(changed));
    expect(verified.hashMatches).toBe(false);
  });

  it("rejects malformed records", () => {
    expect(() => parseRunRecord("{}")).toThrow();
    expect(() => parseRunRecord("not json")).toThrow();
  });
});
