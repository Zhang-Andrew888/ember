import { describe, expect, it } from "vitest";
import { AgentId, ObservationId, SiteId, SimTimeMs, WorkUnits, EdgeId, Meters } from "@ember/domain";
import type { Observation } from "@ember/domain";
import { GRID_EDGE, KnowledgeStore } from "./index.js";

const scout = AgentId.parse("scout");
const crew = AgentId.parse("crew-1");

function obs(
  id: string,
  by: AgentId,
  at: number,
  cells: [number, "unburned" | "burning" | "burned"][],
  received = at,
): Observation {
  return {
    id: ObservationId.parse(id),
    sourceAgentId: by,
    observedAt: SimTimeMs.parse(at),
    receivedAt: SimTimeMs.parse(received),
    spatialFootprint: { centerX: Meters.parse(0), centerY: Meters.parse(0), radius: Meters.parse(150) },
    observedFields: cells.map(([cellIndex, burnState]) => ({
      kind: "cell" as const,
      edgeId: GRID_EDGE,
      cellIndex,
      burnState,
    })),
  };
}

describe("knowledge/KnowledgeStore", () => {
  it("records observed cells and advances its revision", () => {
    const store = new KnowledgeStore(crew);
    expect(store.revision).toBe(0);
    store.ingest(obs("o1", crew, 1000, [[5, "burning"]]));
    expect(store.revision).toBe(1);
    expect(store.cellBelief(5)?.state).toBe("burning");
    expect(store.cellBelief(6)).toBeUndefined();
  });

  it("lets a newer sighting supersede an older one but not the reverse", () => {
    const store = new KnowledgeStore(crew);
    store.ingest(obs("o1", crew, 1000, [[5, "unburned"]]));
    store.ingest(obs("o2", crew, 5000, [[5, "burning"]]));
    store.ingest(obs("o3", crew, 2000, [[5, "unburned"]]));
    expect(store.cellBelief(5)?.state).toBe("burning");
    expect(store.cellBelief(5)?.observedAt).toBe(5000);
    expect(store.observations()).toHaveLength(3);
  });

  it("keeps a conservative conflict when equally timed reports disagree", () => {
    const store = new KnowledgeStore(crew);
    store.ingest(obs("o1", crew, 4000, [[9, "unburned"]]));
    store.ingest(obs("o2", scout, 4000, [[9, "burning"]]));
    const belief = store.cellBelief(9);
    expect(belief?.conflict).toBe(true);
    expect(belief?.state).toBe("burning");
  });

  it("keeps a fresh local sighting above an older coordinator relay", () => {
    const store = new KnowledgeStore(crew);
    store.ingest(obs("local", crew, 9000, [[3, "burning"]]));
    store.ingestRelay(obs("old", scout, 2000, [[3, "unburned"]]), SimTimeMs.parse(9500));
    expect(store.cellBelief(3)?.state).toBe("burning");
    expect(store.cellBelief(3)?.observationId).toBe("local");
  });

  it("preserves source and observation time on relay and stamps the delivery time", () => {
    const store = new KnowledgeStore(crew);
    store.ingestRelay(obs("r1", scout, 2000, [[3, "burning"]]), SimTimeMs.parse(12_000));
    const belief = store.cellBelief(3);
    expect(belief?.sourceAgentId).toBe("scout");
    expect(belief?.observedAt).toBe(2000);
    expect(belief?.receivedAt).toBe(12_000);
    expect(belief?.provenance).toBe("relay");
  });

  it("ignores a duplicate observation id without bumping the revision", () => {
    const store = new KnowledgeStore(crew);
    store.ingest(obs("o1", crew, 1000, [[5, "burning"]]));
    const rev = store.revision;
    expect(store.ingest(obs("o1", crew, 1000, [[5, "burning"]]))).toBe(false);
    expect(store.ingestRelay(obs("o1", crew, 1000, [[5, "burning"]]), SimTimeMs.parse(2000))).toBe(false);
    expect(store.revision).toBe(rev);
  });

  it("marks beliefs stale after 30 simulated seconds without erasing them", () => {
    const store = new KnowledgeStore(crew);
    store.ingest(obs("o1", crew, 10_000, [[5, "unburned"]]));
    const belief = store.cellBelief(5);
    expect(belief).toBeDefined();
    expect(store.isStale(belief!, SimTimeMs.parse(40_000))).toBe(false);
    expect(store.isStale(belief!, SimTimeMs.parse(40_001))).toBe(true);
    expect(store.cellBelief(5)?.state).toBe("unburned");
  });

  it("never treats a stale or unknown 'clear' as current clearance", () => {
    const store = new KnowledgeStore(crew);
    store.ingest(obs("o1", crew, 10_000, [[5, "unburned"]]));
    expect(store.isCurrentlyClear(5, SimTimeMs.parse(20_000))).toBe(true);
    expect(store.isCurrentlyClear(5, SimTimeMs.parse(60_000))).toBe(false);
    expect(store.isCurrentlyClear(77, SimTimeMs.parse(20_000))).toBe(false);
  });

  it("treats burning and burned cells as closed for the rest of the incident", () => {
    const store = new KnowledgeStore(crew);
    store.ingest(obs("o1", crew, 1000, [[5, "burning"], [6, "unburned"]]));
    expect([...store.closedCells()]).toEqual([5]);
    store.ingest(obs("o2", scout, 900, [[5, "unburned"]]));
    expect(store.closedCells().has(5)).toBe(true);
  });

  it("tracks site progress by newest observation", () => {
    const store = new KnowledgeStore(crew);
    const site = SiteId.parse("site-a");
    const siteObs = (id: string, at: number, work: number): Observation => ({
      ...obs(id, crew, at, []),
      observedFields: [
        { kind: "site", siteId: site, completedWork: WorkUnits.parse(work), damage: 0, destroyed: false },
      ],
    });
    store.ingest(siteObs("s2", 5000, 50));
    store.ingest(siteObs("s1", 1000, 10));
    expect(store.siteBelief(site)?.completedWork).toBe(50);
  });

  it("resolves equal-time site observations the same way in either arrival order", () => {
    const site = SiteId.parse("site-a");
    const siteObs = (id: string, work: number): Observation => ({
      ...obs(id, crew, 3000, []),
      observedFields: [
        { kind: "site", siteId: site, completedWork: WorkUnits.parse(work), damage: 0, destroyed: false },
      ],
    });
    const a = new KnowledgeStore(crew);
    a.ingest(siteObs("s1", 10));
    a.ingest(siteObs("s2", 20));
    const b = new KnowledgeStore(crew);
    b.ingest(siteObs("s2", 20));
    b.ingest(siteObs("s1", 10));
    expect(a.siteBelief(site)?.completedWork).toBe(b.siteBelief(site)?.completedWork);
  });

  it("ignores non-grid cell fields but retains them in history", () => {
    const store = new KnowledgeStore(crew);
    const o = obs("o1", crew, 1000, []);
    store.ingest({
      ...o,
      observedFields: [
        { kind: "cell", edgeId: EdgeId.parse("road-1"), cellIndex: 0, burnState: "burning" },
      ],
    });
    expect(store.closedCells().size).toBe(0);
    expect(store.observations()).toHaveLength(1);
  });

  it("hashes identical content identically and independent of arrival order", () => {
    const a = new KnowledgeStore(crew);
    const b = new KnowledgeStore(crew);
    const o1 = obs("o1", crew, 1000, [[5, "burning"]]);
    const o2 = obs("o2", crew, 2000, [[6, "burning"]]);
    a.ingest(o1);
    a.ingest(o2);
    b.ingest(o2);
    b.ingest(o1);
    expect(a.inputHash()).toBe(b.inputHash());
    b.ingest(obs("o3", crew, 3000, [[7, "burning"]]));
    expect(a.inputHash()).not.toBe(b.inputHash());
  });

  it("keeps stores of different agents independent", () => {
    const coordinator = new KnowledgeStore(AgentId.parse("coordinator"));
    const crewStore = new KnowledgeStore(crew);
    coordinator.ingest(obs("s1", scout, 1000, [[5, "burning"]]));
    expect(crewStore.cellBelief(5)).toBeUndefined();
    expect(crewStore.revision).toBe(0);
  });

  it("snapshots the observation history", () => {
    const store = new KnowledgeStore(crew);
    store.ingest(obs("o1", crew, 1000, [[5, "burning"]]));
    const snap = store.snapshot(SimTimeMs.parse(2000));
    expect(snap.agentId).toBe("crew-1");
    expect(snap.revision).toBe(1);
    expect(snap.asOfSimTimeMs).toBe(2000);
    expect(snap.observations).toHaveLength(1);
  });
});
