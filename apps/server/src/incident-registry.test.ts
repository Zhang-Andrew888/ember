import { describe, expect, it } from "vitest";
import { buildSyntheticScenario, SIM_DEFAULTS } from "@ember/simulation";
import { cellIndexOf } from "@ember/simulation/model";
import { ENDED_PUMP_GRACE_MS } from "./hub.js";
import { FINISHED_RETENTION_MS, IncidentRegistry, UNSTARTED_RETENTION_MS } from "./incident-registry.js";

class FakeClock {
  t = 1_000;
  nowMs(): number {
    return this.t;
  }
}

/** One crew and one site with the fire in a far corner: cheap to run to the time limit. */
function quickScenario() {
  const base = buildSyntheticScenario({ agents: ["crew-1"], sites: ["site-a"] });
  return { ...base, map: { ...base.map, initialFireCells: [cellIndexOf(30, 1500)!] } };
}

const clock = { nowMs: () => 0 };

/** End the sim at the horizon without pumping wall time through LiveRun (hundreds of steps). */
function endIncidentAtHorizon(record: ReturnType<IncidentRegistry["create"]>): void {
  record.session.incident.setWallElapsed(SIM_DEFAULTS.realPlayLimitMs);
  record.session.incident.advanceTo(SIM_DEFAULTS.incidentHorizonMs);
}

describe("IncidentRegistry.create", () => {
  it("uses a random seed independent of the public incident id", () => {
    const registry = new IncidentRegistry();
    const record = registry.create({}, clock);
    expect(record.seed).not.toBe(`incident-${record.id}`);
    expect(record.seed).not.toContain(record.id);
    expect(record.seed).toMatch(/^[0-9a-f]{32}$/);
  });
});

describe("IncidentRegistry authorization", () => {
  it("authorizes the right token for the right incident only", () => {
    const clock = new FakeClock();
    const registry = new IncidentRegistry("seed");
    const a = registry.create({}, clock);
    const b = registry.create({}, clock);
    expect(registry.authorize(a.id, a.token)).toBe(a);
    expect(registry.authorize(a.id, b.token)).toBeUndefined();
    expect(registry.authorize(a.id, undefined)).toBeUndefined();
    expect(registry.authorize("missing", a.token)).toBeUndefined();
  });
});

describe("IncidentRegistry sweep", () => {
  it("drops an incident that was never started once the retention window passes, and revokes its token", () => {
    const clock = new FakeClock();
    const registry = new IncidentRegistry("seed");
    const record = registry.create({}, clock);
    expect(registry.sweep(clock.t + UNSTARTED_RETENTION_MS)).toEqual([]);
    const dropped = registry.sweep(clock.t + UNSTARTED_RETENTION_MS + 1);
    expect(dropped).toEqual([record]);
    expect(registry.get(record.id)).toBeUndefined();
    expect(registry.authorize(record.id, record.token)).toBeUndefined();
  });

  it("keeps a started, still-running incident however long it has been open", () => {
    const clock = new FakeClock();
    const registry = new IncidentRegistry("seed");
    const record = registry.create({}, clock);
    registry.start(record);
    expect(registry.sweep(clock.t + 10 * UNSTARTED_RETENTION_MS)).toEqual([]);
    expect(registry.get(record.id)).toBe(record);
  });

  it("keeps a finished incident for the replay window, then drops it", () => {
    const clock = new FakeClock();
    const registry = new IncidentRegistry("seed");
    const record = registry.create(
      { scenario: quickScenario(), session: { uncontrolled: ["crew-1"] } },
      clock,
    );
    registry.start(record);
    endIncidentAtHorizon(record);
    expect(record.session.incident.ended).toBe(true);

    const seenAt = clock.t;
    expect(registry.sweep(seenAt)).toEqual([]); // first sight of the end: start the window
    expect(registry.sweep(seenAt + FINISHED_RETENTION_MS)).toEqual([]);
    expect(registry.sweep(seenAt + FINISHED_RETENTION_MS + 1)).toEqual([record]);
    expect(registry.get(record.id)).toBeUndefined();
  });
});

describe("LiveRun after the incident ends", () => {
  it("stops advancing once the drain grace period has passed", () => {
    const clock = new FakeClock();
    const registry = new IncidentRegistry("seed");
    const record = registry.create(
      { scenario: quickScenario(), session: { uncontrolled: ["crew-1"] } },
      clock,
    );
    registry.start(record);
    endIncidentAtHorizon(record);
    expect(record.session.incident.ended).toBe(true);

    let afterSteps = 0;
    const original = record.hub.afterStep.bind(record.hub);
    record.hub.afterStep = () => {
      afterSteps += 1;
      original();
    };
    clock.t += 1_000;
    record.live.safePump(); // still inside the grace period: keeps draining
    expect(afterSteps).toBeGreaterThan(0);

    const before = afterSteps;
    clock.t += ENDED_PUMP_GRACE_MS + 1_000;
    record.live.safePump(); // grace is over: nothing runs any more
    record.live.safePump();
    expect(afterSteps).toBe(before);
  });
});
