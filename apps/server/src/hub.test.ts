import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_FORECAST_CONFIG } from "@ember/forecast";
import { buildSyntheticScenario, type SimScenario } from "@ember/simulation";
import { cellIndexOf } from "@ember/simulation/model";
import { ConversationBridge } from "./conversation.js";
import { LiveRun, SessionHub } from "./hub.js";
import { parseServerWire } from "./protocol.js";
import { IncidentSession } from "./session.js";

vi.setConfig({ testTimeout: 300_000 });

// Long synchronous tests starve the worker's RPC channel; yield a macrotask between tests so it can flush.
afterEach(async () => {
  await new Promise<void>((resolve) => setTimeout(() => resolve(), 0));
});

const SECRET_SEED = "SECRET-SEED-XYZ-9183";

function wire(raw: string) {
  return parseServerWire(raw)!;
}
const patch = (x: number, y: number): number[] => [cellIndexOf(x, y)!, cellIndexOf(x + 25, y)!, cellIndexOf(x, y + 25)!, cellIndexOf(x + 25, y + 25)!];
const steady = {
  ...DEFAULT_FORECAST_CONFIG,
  prior: {
    spreadMultiplier: { min: 0.6, max: 0.8 },
    windOffsetDeg: { min: -5, max: 5 },
    shiftTimeMs: { min: 1_300_000, max: 1_400_000 },
    postShiftDeg: { min: 45, max: 100 },
  },
};

class FakeClock {
  t = 5000;
  nowMs(): number {
    return this.t;
  }
}

function setup(scenario?: SimScenario) {
  const base = buildSyntheticScenario();
  const sc = scenario ?? { ...base, map: { ...base.map, initialFireCells: patch(230, 1100) } };
  const session = new IncidentSession({ scenario: sc, seed: SECRET_SEED, overrides: { spreadMultiplier: 1.3737373, windShiftMs: 333_000, initialWindRad: 0.1234567 }, controllerConfig: { forecast: steady } });
  const bridge = new ConversationBridge(session);
  const hub = new SessionHub(session, bridge);
  const clock = new FakeClock();
  const live = new LiveRun(session, bridge, hub, clock);
  return { session, bridge, hub, clock, live };
}

describe("wire protocol and information boundary", () => {
  it("never sends private parameters, the seed or truth fire state in any message during a run", () => {
    const { session, hub, clock, live } = setup();
    const id = hub.connect();
    live.start();
    const all: string[] = [...hub.drain(id)];
    for (let i = 0; i < 100; i++) {
      clock.t += 1000;
      live.pump();
      all.push(...hub.drain(id));
      if (i === 30) hub.handle(id, JSON.stringify({ type: "say", text: "Crew 2, protect the lodge", idempotencyKey: "k1" }), live.wallElapsedMs);
    }
    all.push(...hub.drain(id));
    expect(all.length).toBeGreaterThan(100);
    const blob = all.join("\n");
    for (const forbidden of [SECRET_SEED, "privateWorld", "spreadMultiplier", "windShift", "postShift", "ignitedAt", "cellState", "initialWindRad", "1.3737373", "0.1234567"]) {
      expect(blob).not.toContain(forbidden);
    }
    // Every message is valid under the shared schema and carries only whitelisted fields.
    for (const m of all) expect(parseServerWire(m)).not.toBeNull();
    const lastView = [...all]
      .reverse()
      .map((m) => parseServerWire(m))
      .find((m) => m?.type === "view");
    const seenBurning =
      lastView?.type === "view" ? lastView.view.observedCells.filter((c) => c.burnState !== "unburned").length : 0;
    const truth = session.incident.truth().cellState;
    let trueBurning = 0;
    for (const c of truth) if (c === 2 || c === 3) trueBurning += 1;
    // The coordinator has seen only part of the fire; the rest never left the simulator.
    expect(trueBurning).toBeGreaterThan(seenBurning);
  });

  it("rejects malformed or unknown client messages without touching the incident", () => {
    const { hub, session } = setup();
    const id = hub.connect();
    hub.drain(id);
    for (const bad of ["not json", "{}", JSON.stringify({ type: "teleport" }), JSON.stringify({ type: "say", text: "", idempotencyKey: "k" }), JSON.stringify({ type: "say", text: "x".repeat(5000), idempotencyKey: "k" })]) {
      hub.handle(id, bad, 0);
    }
    const msgs = hub.drain(id).map(wire);
    expect(msgs.filter((m) => m.type === "notice" && m.kind === "bad_message")).toHaveLength(5);
    expect(session.incident.inputLog).toHaveLength(0);
  });

  it("commits push-to-talk once on release, suspends playback while held, and acknowledges", () => {
    const { hub, bridge, live, clock } = setup();
    const id = hub.connect();
    live.start();
    hub.drain(id);
    hub.handle(id, JSON.stringify({ type: "ptt_begin" }), 1000);
    expect(bridge.scheduler.isRecording).toBe(true);
    hub.handle(id, JSON.stringify({ type: "ptt_release", transcript: "Crew 2, hold position" }), 3000);
    expect(bridge.scheduler.isRecording).toBe(false);
    hub.handle(id, JSON.stringify({ type: "ptt_release", transcript: "again" }), 3100);
    clock.t += 1000;
    live.pump();
    const msgs = hub.drain(id).map(wire);
    const receipts = msgs.filter((m) => m.type === "receipt");
    expect(receipts).toHaveLength(1);
    expect(receipts[0]?.receipt).toMatchObject({ status: "accepted", recipientId: "crew-2" });
  });

  it("lets the user inspect an agent without changing the addressed recipient", () => {
    const { hub, bridge, live } = setup();
    const id = hub.connect();
    live.start();
    hub.handle(id, JSON.stringify({ type: "say", text: "Crew 2, hold position", idempotencyKey: "a" }), 100);
    live.pump();
    expect(bridge.gateway.activeRecipientId).toBe("crew-2");
    hub.drain(id);
    hub.handle(id, JSON.stringify({ type: "inspect", agentId: "crew-3" }), 200);
    hub.handle(id, JSON.stringify({ type: "inspect", agentId: "nobody" }), 300);
    const msgs = hub.drain(id).map(wire);
    expect(msgs.find((m) => m.type === "inspection")?.agentId).toBe("crew-3");
    expect(msgs.some((m) => m.type === "notice" && m.kind === "bad_message")).toBe(true);
    expect(bridge.gateway.activeRecipientId).toBe("crew-2");
    // A follow-up with no name still goes to the previously addressed crew.
    hub.handle(id, JSON.stringify({ type: "say", text: "resume your own judgment", idempotencyKey: "b" }), 400);
    const follow = hub.drain(id).map(wire);
    expect(follow.find((m) => m.type === "receipt")?.receipt?.recipientId).toBe("crew-2");
  });

  it("retains a half-submitted utterance as unsent and only sends it on explicit resend", () => {
    const { hub, session } = setup();
    const id = hub.connect();
    hub.drain(id);
    hub.handle(id, JSON.stringify({ type: "ptt_begin" }), 1000);
    hub.disconnect(id, 2500, "Crew 2, protect the");
    // Capture times are wall milliseconds throughout, never mixed with simulated time.
    expect(hub.unsentUtterance(id)).toMatchObject({ startedMs: 1000, releasedMs: 2500 });
    expect(session.incident.inputLog).toHaveLength(0);
    hub.reconnect(id);
    const back = hub.drain(id).map(wire);
    const unsentNotice = back.find((m) => m.type === "notice" && m.kind === "unsent_utterance");
    expect(unsentNotice?.type === "notice" ? unsentNotice.detail : undefined).toBe("Crew 2, protect the");
    hub.handle(id, JSON.stringify({ type: "resend" }), 9000);
    const after = hub.drain(id).map(wire);
    expect(after.some((m) => m.type === "receipt")).toBe(true);
  });
});

describe("live run", () => {
  it("advances only to the due simulated time and reports a backlog instead of slowing", () => {
    const { session, clock, live } = setup();
    live.start();
    clock.t += 30_000;
    live.pump();
    expect(session.incident.simTimeMs).toBe(150_000);
    expect(live.failures).toHaveLength(1);
    expect(live.failures[0]?.kind).toBe("processing_backlog");
  });

  it("sends the ended message once and rejects later commands", () => {
    const base = buildSyntheticScenario({ agents: ["crew-1"], sites: ["site-a"] });
    const { session, hub, clock, live } = setup({ ...base, map: { ...base.map, initialFireCells: patch(1500, 100) } });
    const id = hub.connect();
    live.start();
    clock.t += 400_000; // past five real minutes: the incident is finalized through tick 1,500
    live.pump();
    hub.afterStep();
    expect(session.incident.ended).toBe(true);
    const msgs = hub.drain(id).map(wire);
    expect(msgs.filter((m) => m.type === "ended")).toHaveLength(1);
    hub.handle(id, JSON.stringify({ type: "say", text: "Crew 1, hold", idempotencyKey: "late" }), live.wallElapsedMs);
    const reply = hub.drain(id).map(wire);
    expect(reply.find((m) => m.type === "receipt")?.receipt?.status).toBe("incident_ended");
  });
});
