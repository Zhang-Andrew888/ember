import { describe, expect, it } from "vitest";
import { AgentId, NodeId, SiteId } from "@ember/domain";
import { Incident, authoredCommit, buildSyntheticScenario } from "@ember/simulation";
import { RoadIndex } from "@ember/simulation/model";
import { IncidentRunner, type MonotonicClock } from "./runner.js";

class FakeClock implements MonotonicClock {
  t = 10_000;
  nowMs(): number {
    return this.t;
  }
}

function makeRunner(seed = "run") {
  const clock = new FakeClock();
  const incident = new Incident({ scenario: buildSyntheticScenario(), seed });
  return { clock, runner: new IncidentRunner(incident, clock), incident };
}

function missionInput(incident: Incident) {
  return authoredCommit({
    road: new RoadIndex(incident.scenario.map),
    agentId: AgentId.parse("crew-1"),
    planId: "m1",
    knowledgeRevision: incident.agentRevision(AgentId.parse("crew-1")),
    startNode: NodeId.parse("n-rw"),
    departMs: 0,
    approach: ["e-rw-j1", "e-j1-s", "e-s-h", "e-h-sa"],
    workSiteId: SiteId.parse("site-a"),
    workMs: 120_000,
    back: ["e-h-sa", "e-s-h", "e-j1-s", "e-rw-j1"],
  });
}

/** Play a full five-minute run, pumping at the given wall-time cadence (ms, may vary). */
function play(cadence: (i: number) => number, seed = "run") {
  const { clock, runner, incident } = makeRunner(seed);
  runner.start();
  const t0 = clock.t;
  let sent = false;
  let i = 0;
  while (runner.wallElapsedMs < 300_000) {
    const next = clock.t + cadence(i++);
    // The input is issued at the same wall instant in every run; only the pumping differs.
    if (!sent && next - t0 >= 20_000) {
      clock.t = t0 + 20_000;
      runner.receive(missionInput(incident));
      sent = true;
    }
    clock.t = Math.max(clock.t, next);
    runner.pump();
  }
  runner.pump();
  return { incident, runner };
}

describe("incident runner", () => {
  it("maps five real minutes onto 1,500 simulated seconds and then stops", () => {
    const { clock, runner, incident } = makeRunner();
    runner.start();
    clock.t += 60_000;
    runner.pump();
    expect(incident.simTimeMs).toBe(300_000);
    clock.t += 240_000;
    runner.pump();
    expect(incident.simTimeMs).toBe(1_500_000);
    expect(incident.ended).toBe(true);
    expect(incident.end?.matchingReasons).toContain("time_expired");
    expect(incident.end?.wallElapsedMs).toBe(300_000);
  });

  it("is unaffected by pump cadence, stalls or one giant late pump", () => {
    const steady = play(() => 200);
    const jittery = play((i) => (i % 7 === 0 ? 1900 : 40));
    const stalled = play(() => 29_000); // a provider/render stall: ten pumps for the whole run
    expect(jittery.incident.snapshotHash()).toBe(steady.incident.snapshotHash());
    expect(stalled.incident.snapshotHash()).toBe(steady.incident.snapshotHash());
    expect(stalled.incident.end?.tick).toBe(steady.incident.end?.tick);
  });

  it("applies an input at the due tick for its wall time, not the lagging tick", () => {
    const a = makeRunner();
    const b = makeRunner();
    a.runner.start();
    b.runner.start();
    a.clock.t += 10_000;
    b.clock.t += 10_000;
    a.runner.pump(); // a is current; b has not pumped and lags
    const inputA = a.runner.receive({ kind: "set_active_recipient", recipientId: AgentId.parse("crew-1") });
    const inputB = b.runner.receive({ kind: "set_active_recipient", recipientId: AgentId.parse("crew-1") });
    expect(inputA.accepted && inputB.accepted).toBe(true);
    a.runner.pump();
    b.runner.pump();
    expect(a.incident.inputLog[0]?.appliedAtMs).toBe(b.incident.inputLog[0]?.appliedAtMs);
  });

  it("reports a processing backlog instead of slowing the incident", () => {
    const { clock, runner, incident } = makeRunner();
    runner.start();
    clock.t += 30_000;
    runner.pump();
    expect(runner.failures).toHaveLength(1);
    expect(runner.failures[0]?.kind).toBe("processing_backlog");
    expect(incident.simTimeMs).toBe(150_000);
  });

  it("rejects input after five real minutes and records no later input", () => {
    const { clock, runner, incident } = makeRunner();
    runner.start();
    clock.t += 300_000;
    const receipt = runner.receive({ kind: "set_active_recipient", recipientId: AgentId.parse("crew-1") });
    expect(receipt.accepted).toBe(false);
    expect(incident.inputLog).toHaveLength(0);
  });
});
