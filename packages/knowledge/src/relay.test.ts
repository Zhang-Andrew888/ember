import { describe, expect, it } from "vitest";
import { AgentId, ObservationId, SimTimeMs, SiteId, Meters, WorkUnits, type Observation } from "@ember/domain";
import { DEFAULT_RELAY_POLICY, KnowledgeStore, selectRelay } from "./index.js";

const scout = AgentId.parse("scout");
const crew1 = AgentId.parse("crew-1");

function obs(id: string, by: AgentId, at: number, cells: [number, "unburned" | "burning" | "burned"][]): Observation {
  return {
    id: ObservationId.parse(id),
    sourceAgentId: by,
    observedAt: SimTimeMs.parse(at),
    receivedAt: SimTimeMs.parse(at),
    spatialFootprint: { centerX: Meters.parse(0), centerY: Meters.parse(0), radius: Meters.parse(150) },
    observedFields: cells.map(([gridCellIndex, burnState]) => ({ kind: "cell" as const, gridCellIndex, burnState })),
  };
}
const t = (ms: number) => SimTimeMs.parse(ms);
const none = new Set<string>();

describe("contradictions", () => {
  it("records a later fire sighting that overturns an earlier clear one", () => {
    const s = new KnowledgeStore(scout);
    s.ingest(obs("o1", scout, 10_000, [[5, "unburned"]]));
    expect(s.contradictions()).toHaveLength(0);
    s.ingest(obs("o2", scout, 40_000, [[5, "burning"]]));
    const [c] = s.contradictions();
    expect(c).toMatchObject({ cell: 5, kind: "clear_overturned", overturnedObservationId: "o1", byObservationId: "o2" });
    expect(s.isCurrentlyClear(5, t(41_000))).toBe(false);
  });

  it("does not record a contradiction when an older clear sighting arrives after newer fire", () => {
    const s = new KnowledgeStore(crew1);
    s.ingest(obs("new", scout, 40_000, [[5, "burning"]]));
    s.ingestRelay(obs("old", scout, 10_000, [[5, "unburned"]]), t(50_000));
    expect(s.contradictions()).toHaveLength(0);
    expect(s.cellBelief(5)?.state).toBe("burning");
  });

  it("records equal-time disagreement and is order independent", () => {
    const a = obs("a", scout, 20_000, [[7, "unburned"]]);
    const b = obs("b", crew1, 20_000, [[7, "burning"]]);
    const x = new KnowledgeStore(crew1);
    x.ingest(a);
    x.ingest(b);
    const y = new KnowledgeStore(crew1);
    y.ingest(b);
    y.ingest(a);
    expect(x.contradictions().map((c) => c.kind)).toEqual(["equal_time_conflict"]);
    expect(y.contradictions().map((c) => c.kind)).toEqual(["equal_time_conflict"]);
    expect(x.cellBelief(7)?.state).toBe("burning");
  });

  it("recovers conservatively: a contradicted cell stays closed whatever arrives later", () => {
    const s = new KnowledgeStore(crew1);
    s.ingest(obs("o1", crew1, 10_000, [[3, "unburned"]]));
    s.ingest(obs("o2", crew1, 20_000, [[3, "burning"]]));
    s.ingest(obs("o3", crew1, 90_000, [[3, "unburned"]]));
    expect(s.closedCells().has(3)).toBe(true);
    expect(s.isCurrentlyClear(3, t(91_000))).toBe(false);
    expect(s.contradictedCells()).toEqual([3]);
  });

  it("does not repeat the same contradiction", () => {
    const s = new KnowledgeStore(crew1);
    s.ingest(obs("o1", crew1, 10_000, [[3, "unburned"]]));
    s.ingest(obs("o2", crew1, 20_000, [[3, "burning"]]));
    s.ingest(obs("o2", crew1, 20_000, [[3, "burning"]]));
    expect(s.contradictions()).toHaveLength(1);
  });
});

describe("staleness", () => {
  it("lists stale beliefs without erasing them and keeps their observation time", () => {
    const s = new KnowledgeStore(crew1);
    s.ingest(obs("o1", crew1, 10_000, [[1, "unburned"]]));
    s.ingest(obs("o2", crew1, 50_000, [[2, "unburned"]]));
    const stale = s.staleBeliefs(t(60_000));
    expect(stale.cells.map((b) => b.cell)).toEqual([1]);
    expect(stale.cells[0]?.observedAt).toBe(10_000);
    expect(s.cellBelief(1)?.state).toBe("unburned");
  });

  it("ageMs never goes negative", () => {
    const s = new KnowledgeStore(crew1);
    expect(s.ageMs({ observedAt: t(10_000) }, t(4_000))).toBe(0);
    expect(s.ageMs({ observedAt: t(10_000) }, t(25_000))).toBe(15_000);
  });
});

describe("what is relayed", () => {
  it("relays what the recipient lacks, keeping source and observed time", () => {
    const s = new KnowledgeStore(scout);
    s.ingest(obs("o1", scout, 10_000, [[1, "burning"]]));
    const [r] = selectRelay(s, none, t(20_000));
    expect(r?.observation.id).toBe("o1");
    expect(r?.observation.observedAt).toBe(10_000);
    expect(r?.observation.sourceAgentId).toBe("scout");
    expect(r?.ageMs).toBe(10_000);
  });

  it("never relays what the recipient already has", () => {
    const s = new KnowledgeStore(scout);
    s.ingest(obs("o1", scout, 10_000, [[1, "burning"]]));
    expect(selectRelay(s, new Set(["o1"]), t(20_000))).toEqual([]);
  });

  it("skips an observation every field of which a newer sighting superseded", () => {
    const s = new KnowledgeStore(scout);
    s.ingest(obs("old", scout, 10_000, [[1, "unburned"]]));
    s.ingest(obs("new", scout, 20_000, [[1, "unburned"]]));
    expect(selectRelay(s, none, t(25_000)).map((c) => c.observation.id)).toEqual(["new"]);
  });

  it("keeps an observation when it is the newest on at least one cell", () => {
    const s = new KnowledgeStore(scout);
    s.ingest(obs("a", scout, 10_000, [[1, "unburned"], [2, "unburned"]]));
    s.ingest(obs("b", scout, 20_000, [[1, "unburned"]]));
    expect(selectRelay(s, none, t(25_000)).map((c) => c.observation.id).sort()).toEqual(["a", "b"]);
  });

  it("lets old clear sightings lapse but never lets a fire sighting lapse, and flags age instead of refreshing", () => {
    const s = new KnowledgeStore(scout);
    s.ingest(obs("clear", scout, 0, [[1, "unburned"]]));
    s.ingest(obs("fire", scout, 0, [[2, "burned"]]));
    const late = t(DEFAULT_RELAY_POLICY.maxClearAgeMs + 1_000);
    const out = selectRelay(s, none, late);
    expect(out.map((c) => c.observation.id)).toEqual(["fire"]);
    expect(out[0]?.stale).toBe(true);
    expect(out[0]?.observation.observedAt).toBe(0);
  });

  it("orders fire first, then newest, then id; caps the count; is deterministic", () => {
    const s = new KnowledgeStore(scout);
    s.ingest(obs("c2", scout, 30_000, [[1, "unburned"]]));
    s.ingest(obs("c1", scout, 30_000, [[2, "unburned"]]));
    s.ingest(obs("f1", scout, 10_000, [[3, "burning"]]));
    const order = selectRelay(s, none, t(35_000)).map((c) => c.observation.id);
    expect(order).toEqual(["f1", "c1", "c2"]);
    expect(selectRelay(s, none, t(35_000), { ...DEFAULT_RELAY_POLICY, maxItems: 2 }).map((c) => c.observation.id)).toEqual(["f1", "c1"]);
    expect(selectRelay(s, none, t(35_000)).map((c) => c.observation.id)).toEqual(order);
  });

  it("handles site observations: relays the newest site progress only", () => {
    const s = new KnowledgeStore(scout);
    const site = (id: string, at: number, w: number): Observation => ({
      ...obs(id, scout, at, []),
      observedFields: [{ kind: "site", siteId: SiteId.parse("site-a"), completedWork: WorkUnits.parse(w), damage: 0, destroyed: false }],
    });
    s.ingest(site("s1", 10_000, 5));
    s.ingest(site("s2", 20_000, 9));
    expect(selectRelay(s, none, t(25_000)).map((c) => c.observation.id)).toEqual(["s2"]);
  });
});
