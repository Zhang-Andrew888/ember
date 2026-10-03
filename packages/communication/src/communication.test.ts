import { describe, expect, it } from "vitest";
import { DecisionEvent, SequenceNumber, SimTimeMs, AgentId } from "@ember/domain";
import {
  AudioScheduler,
  CommandGateway,
  FailingInterpreter,
  IntentEnvelope,
  PushToTalk,
  RecordingSink,
  ScriptedInterpreter,
  lossNarration,
  matchName,
  replyForDecision,
  statusReply,
  type Directory,
  type GatewayEnv,

  type Report,
  type SchedulerEvent,
  type SpeechItem,
} from "./index.js";

const directory: Directory = {
  agents: [
    { id: "crew-1", callsign: "Crew 1", role: "protection_crew" },
    { id: "crew-2", callsign: "Crew 2", role: "protection_crew" },
    { id: "crew-3", callsign: "Crew 3", role: "protection_crew" },
    { id: "scout", callsign: "Scout", role: "scout" },
  ],
  sites: [
    { id: "site-a", name: "Ridge Cabins" },
    { id: "site-b", name: "Waterworks" },
    { id: "site-c", name: "Community Lodge" },
  ],
  scoutPoints: [
    { id: "n-n", name: "north road" },
    { id: "n-s", name: "south junction" },
  ],
  locations: [
    { name: "east corridor", x: 1000, y: 800, radius: 200 },
    { name: "north road", x: 500, y: 1200, radius: 150 },
  ],
};

function makeGateway(over: Partial<GatewayEnv> & { reports?: Report[]; now?: { t: number }; ended?: { v: boolean } } = {}) {
  const now = over.now ?? { t: 100_000 };
  const ended = over.ended ?? { v: false };
  const reports = over.reports ?? [];
  const env: GatewayEnv = {
    directory,
    interpreter: new ScriptedInterpreter(),
    picture: () => reports,
    status: (id) => ({
      callsign: id,
      currentAction: "heading to Waterworks",
      objective: null,
      returnEstimateSec: 240,
      lastRejection: null,
      knownConditions: null,
      lastReport: null,
    }),
    nowSimMs: () => now.t,
    incidentEnded: () => ended.v,
    ...over,
  };
  let n = 0;
  const gw = new CommandGateway(env);
  const say = (text: string, wallMs = 0, key?: string) => gw.submit({ commandId: `cmd-${n}`, text, idempotencyKey: key ?? `k-${n++}`, wallMs });
  return { gw, say, now, ended };
}

const scoutReport = (id: string, timeMs: number, x = 1000, y = 800): Report => ({
  id,
  kind: "sensor_observation",
  sourceAgentId: "scout",
  timeMs,
  text: "fire at the east corridor",
  footprint: { x, y, radius: 150 },
});

describe("recipient addressing", () => {
  it("keeps the addressed recipient for follow-ups and across incoming reports", () => {
    const { gw, say } = makeGateway();
    const first = say("Crew 2, protect the lodge");
    expect(first.outcomes[0]?.receipt.recipientId).toBe("crew-2");
    expect(gw.activeRecipientId).toBe("crew-2");
    // A report from the scout arrives; it is not an input and cannot retarget anything.
    const follow = say("hold position");
    expect(follow.outcomes[0]?.receipt.recipientId).toBe("crew-2");
    expect(follow.outcomes[0]?.actions.some((a) => a.kind === "objective" && a.objective.recipientId === "crew-2")).toBe(true);
  });

  it("changes the active recipient only when a new message names one explicitly", () => {
    const { gw, say } = makeGateway();
    say("Crew 2, hold");
    const rev = gw.recipientRevision;
    const out = say("Crew 1, protect Ridge Cabins");
    expect(gw.activeRecipientId).toBe("crew-1");
    expect(gw.recipientRevision).toBe(rev + 1);
    expect(out.outcomes[0]?.actions[0]).toMatchObject({ kind: "set_recipient", recipientId: "crew-1" });
  });

  it("asks which crew when there is no recipient yet, and for two named crews", () => {
    const { gw, say } = makeGateway();
    const none = say("protect the lodge");
    expect(none.outcomes[0]?.receipt.status).toBe("clarification_required");
    expect(none.outcomes[0]?.actions).toHaveLength(0);
    expect(gw.activeRecipientId).toBeNull();
    const two = say("Crew 1 and Crew 2 protect the lodge");
    expect(two.outcomes[0]?.receipt.status).toBe("clarification_required");
    expect(two.outcomes[0]?.reply).toMatch(/Crew 1 or Crew 2/);
    expect(gw.activeRecipientId).toBeNull();
  });

  it("resolves a clarification answer into the original command", () => {
    const { gw, say } = makeGateway();
    say("protect the lodge");
    expect(gw.pendingClarification).not.toBeNull();
    const answered = say("Crew 3");
    const actions = answered.outcomes[0]?.actions ?? [];
    expect(actions.some((a) => a.kind === "objective" && a.objective.recipientId === "crew-3" && a.objective.targetId === "site-c")).toBe(true);
    expect(gw.pendingClarification).toBeNull();
  });

  it("resolves addressing in input order when interpretation answers arrive out of order", () => {
    const { gw, say } = makeGateway({ interpreter: { interpret: () => null } });
    const t1 = say("Crew 1, hold");
    const t2 = say("hold position");
    const env = (seq: number, id: string, recipient?: string): IntentEnvelope => ({
      commandId: id,
      inputSequence: seq,
      ...(recipient === undefined ? {} : { explicitRecipient: recipient }),
      kind: "objective",
      objective: { kind: "hold" },
      evidenceQueries: [],
      unsupportedClaims: [],
    });
    // The follow-up is interpreted first but must wait for the earlier addressing decision.
    expect(gw.deliver(t2.inputSequence, env(1, "cmd-1"))).toHaveLength(0);
    const released = gw.deliver(t1.inputSequence, env(0, "cmd-0", "Crew 1"));
    expect(released.map((o) => o.receipt.recipientId)).toEqual(["crew-1", "crew-1"]);
  });
});

describe("evidence and claims", () => {
  it("relays the scout's latest uniquely identified report, preserving source and time", () => {
    const { say } = makeGateway({ reports: [scoutReport("obs:scout:50000", 50_000), scoutReport("obs:scout:90000", 90_000)] });
    const out = say("Crew 2, use Scout's latest east corridor report and protect the lodge").outcomes[0]!;
    const relay = out.actions.find((a) => a.kind === "relay");
    expect(relay).toMatchObject({ kind: "relay", observationId: "obs:scout:90000", toAgentId: "crew-2" });
    expect(out.evidence[0]).toMatchObject({ kind: "sensor_observation", sourceRecordId: "obs:scout:90000", timestamp: 90_000 });
    expect(out.actions.some((a) => a.kind === "objective")).toBe(true);
    expect(out.reply).toMatch(/Passed Scout observation from 90 s to Crew 2/);
  });

  it("does not invent facts for a nonexistent or ambiguous report", () => {
    const none = makeGateway({ reports: [] }).say("Crew 2, use Scout's latest east corridor report").outcomes[0]!;
    expect(none.receipt.status).toBe("clarification_required");
    expect(none.actions.filter((a) => a.kind === "relay")).toHaveLength(0);
    expect(none.reply).toMatch(/no received report/);
    // Two different reports at the same instant from the same source: ask, do not guess.
    const tie = makeGateway({ reports: [scoutReport("a", 70_000), scoutReport("b", 70_000)] }).say("Crew 2, use Scout's latest east corridor report").outcomes[0]!;
    expect(tie.receipt.status).toBe("clarification_required");
    expect(tie.actions.filter((a) => a.kind === "relay")).toHaveLength(0);
  });

  it("keeps an unsupported safety claim from removing any hazard or creating an observation", () => {
    const { say } = makeGateway({ reports: [] });
    const out = say("Crew 2, the east road is definitely safe").outcomes[0]!;
    expect(out.receipt.status).toBe("rejected");
    expect(out.notes.some((n) => n.startsWith("unsupported_claim:"))).toBe(true);
    expect(out.actions.some((a) => a.kind === "relay")).toBe(false);
    expect(out.evidence).toHaveLength(0);
  });

  it("never converts an agent's own report into a measured observation", () => {
    const report: Report = { id: "rep-1", kind: "agent_report", sourceAgentId: "scout", timeMs: 60_000, text: "forecast says east closes", footprint: { x: 1000, y: 800, radius: 150 } };
    const out = makeGateway({ reports: [report] }).say("Crew 2, use Scout's latest east corridor report").outcomes[0]!;
    expect(out.actions.some((a) => a.kind === "relay")).toBe(false);
    expect(out.notes).toContain("agent_report_not_converted_to_observation");
    expect(out.evidence[0]?.kind).toBe("agent_report");
  });

  it("rejects objectives the recipient's role cannot do, still relaying supported evidence", () => {
    const { say } = makeGateway({ reports: [scoutReport("o1", 80_000)] });
    const out = say("Scout, protect the lodge").outcomes[0]!;
    expect(out.receipt.status).toBe("rejected");
    expect(out.reply).toMatch(/does not do protection work/);
    expect(out.actions.some((a) => a.kind === "objective")).toBe(false);
  });
});

describe("objective kinds", () => {
  it("maps protect, observe, return, hold and resume onto contract objectives and actions", () => {
    const { say } = makeGateway();
    const obj = (text: string) => say(text).outcomes[0]!.actions.find((a) => a.kind === "objective");
    expect(obj("Crew 1, protect Waterworks")).toMatchObject({ objective: { kind: "protect_site", targetId: "site-b", recipientId: "crew-1" } });
    expect(obj("Scout, check the north road")).toMatchObject({ objective: { kind: "scout_location", targetId: "n-n", recipientId: "scout" } });
    expect(obj("Crew 1, return to refuge")).toMatchObject({ objective: { kind: "return_to_refuge", targetId: null } });
    expect(obj("Crew 1, hold position")).toMatchObject({ objective: { kind: "hold" } });
    const resume = say("Crew 1, resume your own judgment").outcomes[0]!;
    expect(resume.actions).toContainEqual({ kind: "resume_autonomous", agentId: "crew-1" });
  });

  it("rejects what the contract or the recipient's role cannot take, with a reason", () => {
    const { say } = makeGateway();
    const avoid = say("Crew 1, avoid the east corridor").outcomes[0]!;
    expect(avoid.receipt.status).toBe("rejected");
    expect(avoid.reply).toMatch(/not supported by the shared contract/);
    const crewObserve = say("Crew 1, check the north road").outcomes[0]!;
    expect(crewObserve.receipt.status).toBe("rejected");
    expect(crewObserve.reply).toMatch(/not a scout/);
  });

  it("asks which site or point when the target is missing, unknown or ambiguous", () => {
    const { say } = makeGateway();
    expect(say("Crew 1, protect").outcomes[0]?.receipt.status).toBe("clarification_required");
    const unknown = say("Crew 1, protect the harbour").outcomes[0]!;
    expect(unknown.receipt.status).toBe("clarification_required");
    expect(unknown.reply).toMatch(/don't know a site/);
  });

  it("validates interpreter output against the envelope schema", () => {
    expect(() => IntentEnvelope.parse({ commandId: "x", inputSequence: 0, kind: "teleport", evidenceQueries: [], unsupportedClaims: [] })).toThrow();
    expect(IntentEnvelope.parse({ commandId: "x", inputSequence: 0, kind: "status", evidenceQueries: [], unsupportedClaims: [] }).kind).toBe("status");
  });
});

describe("idempotency, timing and ending", () => {
  it("applies exactly one objective revision when a command id is retried", () => {
    const { say } = makeGateway();
    const first = say("Crew 2, protect the lodge", 0, "same-key");
    const retry = say("Crew 2, protect the lodge", 3000, "same-key");
    expect(first.outcomes[0]?.actions.filter((a) => a.kind === "objective")).toHaveLength(1);
    expect(retry.duplicate).toBe(true);
    expect(retry.outcomes[0]).toBe(first.outcomes[0]);
  });

  it("evaluates a delayed interpretation at the current tick, not the utterance time", () => {
    const { gw, say, now } = makeGateway({ interpreter: { interpret: () => null } });
    const t = say("Crew 2, protect the lodge", 0);
    now.t = 250_000; // fire has moved on while the provider was thinking
    const out = gw.deliver(t.inputSequence, {
      commandId: "cmd-0",
      inputSequence: 0,
      explicitRecipient: "Crew 2",
      kind: "objective",
      objective: { kind: "protect", targetName: "Community Lodge" },
      evidenceQueries: [],
      unsupportedClaims: [],
    })[0]!;
    expect(out.evaluatedAtSimMs).toBe(250_000);
    expect(out.receipt.appliedTick).toBe(250_000);
  });

  it("shows still-interpreting at 5 s, fails at 10 s, and ignores a late result", () => {
    const { gw, say } = makeGateway({ interpreter: new FailingInterpreter() });
    const t = say("Crew 2, protect the lodge", 1000);
    gw.poll(5999);
    expect(gw.takeNotices()).toHaveLength(0);
    gw.poll(6000);
    expect(gw.takeNotices()).toEqual([{ kind: "still_interpreting", commandId: "cmd-0" }]);
    const failed = gw.poll(11_000);
    expect(failed[0]?.receipt.status).toBe("rejected");
    expect(failed[0]?.reply).toMatch(/Nothing was applied/);
    const late = gw.deliver(t.inputSequence, { commandId: "cmd-0", inputSequence: 0, explicitRecipient: "Crew 2", kind: "objective", objective: { kind: "hold" }, evidenceQueries: [], unsupportedClaims: [] });
    expect(late).toHaveLength(0);
  });

  it("rejects input and cancels unapplied commands once the incident has ended", () => {
    const { gw, say, ended } = makeGateway({ interpreter: { interpret: () => null } });
    say("Crew 2, hold");
    ended.v = true;
    const cancelled = gw.endIncident();
    expect(cancelled[0]?.receipt.status).toBe("incident_ended");
    const after = say("Crew 1, hold");
    expect(after.outcomes[0]?.receipt.status).toBe("incident_ended");
    expect(after.outcomes[0]?.actions).toHaveLength(0);
  });

  it("answers status queries only from the agent's reportable status", () => {
    const { say } = makeGateway();
    const out = say("Crew 2, what are you doing?").outcomes[0]!;
    expect(out.reply).toBe("Crew 2 is heading to Waterworks. Return estimate: 240 incident seconds.");
    expect(statusReply("Scout", null)).toBe("Scout has nothing to report.");
  });

  it("matches spoken names against public names", () => {
    const sites = directory.sites;
    expect(matchName("the lodge", sites)).toEqual({ kind: "unique", id: "site-c" });
    expect(matchName("Waterworks", sites)).toEqual({ kind: "unique", id: "site-b" });
    expect(matchName("the cabin", sites).kind).toBe("unknown");
    expect(matchName("ridge", sites)).toEqual({ kind: "unique", id: "site-a" });
  });
});

const item = (id: string, tier: 1 | 2 | 3 | 4, text: string, createdMs: number, agentId = "crew-1", planRevision = 1): SpeechItem => ({
  id,
  eventId: `ev-${id}`,
  agentId,
  text,
  tier,
  createdMs,
  planRevision,
});

function scheduler(revisions: Record<string, number> = {}) {
  const sink = new RecordingSink();
  const events: SchedulerEvent[] = [];
  const s = new AudioScheduler({ sink, currentPlanRevision: (a) => revisions[a] ?? 1, onEvent: (e) => events.push(e) });
  return { s, sink, events, revisions };
}

describe("audio scheduler", () => {
  it("speaks the exact committed text and plays one item at a time in priority then event order", () => {
    const { s, sink } = scheduler();
    s.enqueue(item("r1", 4, "Crew 1 is heading to Ridge Cabins.", 1));
    s.enqueue(item("r2", 4, "Crew 2 is holding.", 2));
    s.enqueue(item("c1", 3, "Crew 3 cannot do that.", 3));
    expect(sink.spoken).toEqual(["Crew 1 is heading to Ridge Cabins."]);
    s.finished("r1");
    expect(sink.spoken[1]).toBe("Crew 3 cannot do that.");
    s.finished("c1");
    expect(sink.spoken[2]).toBe("Crew 2 is holding.");
  });

  it("stops routine playback immediately when an urgent report arrives", () => {
    const { s, sink, events } = scheduler();
    s.enqueue(item("r1", 4, "routine status", 1));
    s.enqueue(item("u1", 2, "Crew 2 is withdrawing.", 2, "crew-2"));
    expect(sink.stops).toHaveLength(1);
    expect(sink.spoken).toEqual(["routine status", "Crew 2 is withdrawing."]);
    expect(events.some((e) => e.kind === "interrupted" && e.itemId === "r1")).toBe(true);
    // The urgent sentence itself is not interrupted by another urgent one.
    s.enqueue(item("u2", 1, "Crew 3 is stranded.", 3, "crew-3"));
    expect(sink.stops).toHaveLength(1);
    s.finished("u1");
    expect(sink.spoken[2]).toBe("Crew 3 is stranded.");
  });

  it("suspends playback while recording and gives urgent audio first priority on release", () => {
    const { s, sink, events } = scheduler();
    s.enqueue(item("r1", 4, "routine status", 1));
    s.startRecording();
    expect(sink.current).toBeNull();
    // Urgent arrives during capture: alert shown now, audio held until release.
    s.enqueue(item("u1", 2, "Crew 2 is withdrawing.", 5, "crew-2"), false);
    expect(events.some((e) => e.kind === "alert" && e.itemId === "u1")).toBe(true);
    expect(sink.spoken).toEqual(["routine status"]);
    // A routine response finishes generating during the capture: it must not jump ahead.
    s.enqueue(item("r2", 3, "Crew 1 acknowledged.", 6));
    s.markReady("u1");
    expect(sink.spoken).toEqual(["routine status"]);
    s.stopRecording();
    expect(sink.spoken[1]).toBe("Crew 2 is withdrawing.");
  });

  it("shows 'urgent audio preparing' instead of letting routine speech go first when urgent audio is not ready", () => {
    const { s, sink, events } = scheduler();
    s.startRecording();
    s.enqueue(item("u1", 1, "Crew 2 is stranded.", 1, "crew-2"), false);
    s.enqueue(item("r1", 4, "routine", 2));
    s.stopRecording();
    expect(sink.spoken).toEqual([]);
    expect(events.some((e) => e.kind === "audio_preparing" && e.itemId === "u1")).toBe(true);
    s.markReady("u1");
    expect(sink.spoken).toEqual(["Crew 2 is stranded."]);
  });

  it("skips routine speech whose plan was superseded but never urgent speech", () => {
    const revisions: Record<string, number> = { "crew-1": 1 };
    const { s, sink, events } = scheduler(revisions);
    s.startRecording();
    s.enqueue(item("r1", 4, "Crew 1 is heading to the lodge.", 1, "crew-1", 1));
    s.enqueue(item("u1", 2, "Crew 1 is withdrawing.", 2, "crew-1", 1));
    revisions["crew-1"] = 2;
    s.stopRecording();
    expect(sink.spoken).toEqual(["Crew 1 is withdrawing."]);
    s.finished("u1");
    expect(sink.spoken).toHaveLength(1);
    expect(events.some((e) => e.kind === "dropped" && e.itemId === "r1" && e.reason === "superseded")).toBe(true);
  });

  it("coalesces identical reports for audio but keeps the urgent alert visible", () => {
    const { s, sink, events } = scheduler();
    s.enqueue(item("u1", 2, "Crew 1 is withdrawing.", 1000));
    s.finished("u1");
    s.enqueue(item("u2", 2, "Crew 1 is withdrawing.", 4000));
    expect(sink.spoken).toHaveLength(1);
    expect(events.filter((e) => e.kind === "alert")).toHaveLength(2);
  });

  it("clears queued audio at once and allows one concise end announcement", () => {
    const { s, sink, events } = scheduler();
    s.enqueue(item("r1", 4, "routine one", 1));
    s.enqueue(item("r2", 4, "routine two", 2));
    s.endIncident(item("end", 3, "The incident has ended.", 3, "control"));
    expect(sink.stops.length).toBeGreaterThanOrEqual(1);
    expect(sink.spoken).toEqual(["routine one", "The incident has ended."]);
    expect(events.some((e) => e.kind === "dropped" && e.itemId === "r2" && e.reason === "incident_ended")).toBe(true);
    s.enqueue(item("late", 4, "stale radio traffic", 4));
    s.finished("end");
    expect(sink.spoken).toHaveLength(2);
  });

  it("flush drops every queued sample immediately", () => {
    const { s, sink } = scheduler();
    s.enqueue(item("r1", 4, "one", 1));
    s.enqueue(item("r2", 4, "two", 2));
    s.flush();
    expect(sink.current).toBeNull();
    expect(s.pending()).toHaveLength(0);
  });
});

describe("push to talk capture", () => {
  it("captures the recipient on key-down and commits the complete input exactly once", () => {
    const ptt = new PushToTalk();
    expect(ptt.begin(1000, "crew-2")).toBe(true);
    expect(ptt.begin(1100, "crew-1")).toBe(false);
    const u = ptt.release(4000, "protect the lodge");
    expect(u).toMatchObject({ text: "protect the lodge", capturedRecipientId: "crew-2" });
    expect(ptt.release(4100, "again")).toBeNull();
    expect(ptt.state).toBe("committed");
  });

  it("finishes cleanly on lost focus and retains an unsent utterance after a disconnect", () => {
    const ptt = new PushToTalk();
    ptt.begin(0, null);
    expect(ptt.lostFocus(500, "hold")?.text).toBe("hold");
    expect(ptt.state).toBe("committed");
    ptt.begin(1000, "crew-1");
    ptt.disconnect(2000, "Crew 2, protect the");
    expect(ptt.state).toBe("unsent");
    expect(ptt.unsentUtterance?.text).toBe("Crew 2, protect the");
    expect(ptt.resend()?.text).toBe("Crew 2, protect the");
    expect(ptt.resend()).toBeNull();
  });
});

describe("replies from committed outcomes", () => {
  const decision = (type: DecisionEvent["type"], reason: string, action = ""): DecisionEvent =>
    DecisionEvent.parse({ sequence: SequenceNumber.parse(1), tick: SimTimeMs.parse(1000), agentId: AgentId.parse("crew-2"), type, reasonCode: reason, evidenceIds: [], actualAction: action });

  it("states the committed result, in plain or radio phrasing, without hiding the reason", () => {
    const d = decision("withdrawal_triggered", "route_closed_by_observation");
    expect(replyForDecision("Crew 2", d).text).toBe("Crew 2 is withdrawing. Our observation closed the planned route.");
    expect(replyForDecision("Crew 2", d, "radio").text).toBe("Crew 2, withdrawing. Our observation closed the planned route.");
    expect(replyForDecision("Crew 2", d).tier).toBe(2);
    expect(replyForDecision("Crew 2", decision("retreat_triggered", "no_normal_return")).tier).toBe(1);
    expect(replyForDecision("Crew 2", decision("mission_start", "mission_admitted", "heading to Waterworks")).text).toBe("Crew 2 is heading to Waterworks.");
  });

  it("narrates a loss as control, never as an utterance by the lost crew", () => {
    expect(lossNarration("Crew 3")).toEqual({ text: "Control: Crew 3 has been lost.", tier: 1 });
  });
});
