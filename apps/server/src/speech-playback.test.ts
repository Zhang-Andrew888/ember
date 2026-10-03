import { describe, expect, it } from "vitest";
import type { SpeechItem } from "@ember/communication";
import { buildSyntheticScenario } from "@ember/simulation";
import { ConversationBridge } from "./conversation.js";
import { SessionHub } from "./hub.js";
import { encodeClient, parseServerWire } from "./protocol.js";
import { IncidentSession } from "./session.js";
import { SpeechAudioStore } from "./xai/speech-audio-store.js";
import { ViewRecorder } from "./view-recorder.js";

function line(id: string, text: string, createdMs: number): SpeechItem {
  return {
    id,
    eventId: `ev-${id}`,
    agentId: "crew-1",
    text,
    tier: 4,
    createdMs,
    planRevision: 1,
  };
}

function setup(options: { grokTts?: boolean; playbackAckBudgetMs?: (text: string) => number } = {}) {
  const session = new IncidentSession({ scenario: buildSyntheticScenario(), seed: "speech-queue" });
  const speechStore = new SpeechAudioStore();
  const bridge = new ConversationBridge(session, {
    speechStore,
    grokTts: options.grokTts ?? true,
    ...(options.playbackAckBudgetMs === undefined ? {} : { playbackAckBudgetMs: options.playbackAckBudgetMs }),
  });
  const hub = new SessionHub(session, bridge, new ViewRecorder());
  return { bridge, hub, speechStore };
}

function startedIds(raw: readonly string[]): string[] {
  const ids: string[] = [];
  for (const frame of raw) {
    const msg = parseServerWire(frame);
    if (msg?.type === "audio" && msg.event === "started") ids.push(msg.itemId);
  }
  return ids;
}

describe("live TTS playback queue", () => {
  it("plays two sequential prepared lines and emits two started cues", () => {
    const { bridge, hub, speechStore } = setup();
    speechStore.put("one", new Uint8Array([1, 2, 3]));
    speechStore.put("two", new Uint8Array([4, 5, 6]));
    const id = hub.connect();
    hub.drain(id);

    bridge.scheduler.enqueue(line("one", "Crew 1 is holding.", 1), true);
    bridge.scheduler.enqueue(line("two", "Crew 2 is holding.", 2), true);
    hub.afterStep();

    expect(startedIds(hub.drain(id))).toEqual(["one"]);
    expect(bridge.scheduler.nowPlaying?.id).toBe("one");
    expect(bridge.scheduler.pending().map((item) => item.id)).toEqual(["two"]);

    hub.handle(id, encodeClient({ type: "speech_playback", itemId: "one", outcome: "ended" }), 1_000);
    hub.afterStep();

    expect(startedIds(hub.drain(id))).toEqual(["two"]);
    expect(bridge.scheduler.nowPlaying?.id).toBe("two");
    expect(speechStore.get("two")).toEqual(new Uint8Array([4, 5, 6]));
  });

  it("continues the queue when playback fails", () => {
    const { bridge, hub } = setup();
    const id = hub.connect();
    hub.drain(id);
    bridge.scheduler.enqueue(line("one", "Crew 1 is holding.", 1));
    bridge.scheduler.enqueue(line("two", "Crew 2 is holding.", 2));
    hub.afterStep();
    hub.drain(id);

    hub.handle(id, encodeClient({ type: "speech_playback", itemId: "one", outcome: "failed" }), 1_000);
    hub.afterStep();
    const msgs = hub.drain(id).map((frame) => parseServerWire(frame));
    expect(msgs.some((m) => m?.type === "audio" && m.event === "audio_unavailable" && m.itemId === "one")).toBe(true);
    expect(msgs.some((m) => m?.type === "audio" && m.event === "started" && m.itemId === "two")).toBe(true);
  });

  it("continues the queue after the last listener disconnects and another connects", () => {
    const { bridge, hub } = setup();
    const first = hub.connect();
    hub.drain(first);
    bridge.scheduler.enqueue(line("one", "Crew 1 is holding.", 1));
    bridge.scheduler.enqueue(line("two", "Crew 2 is holding.", 2));
    hub.afterStep();
    expect(startedIds(hub.drain(first))).toEqual(["one"]);

    hub.disconnect(first, 2_000);
    expect(bridge.scheduler.nowPlaying).toBeNull();
    expect(bridge.scheduler.pending().map((item) => item.id)).toEqual(["two"]);

    const second = hub.connect();
    hub.afterStep();
    expect(startedIds(hub.drain(second))).toEqual(["two"]);
  });

  it("does not drop the playing clip when another listener is still connected", () => {
    const { bridge, hub } = setup();
    const first = hub.connect();
    const second = hub.connect();
    hub.drain(first);
    bridge.scheduler.enqueue(line("one", "Crew 1 is holding.", 1));
    bridge.scheduler.enqueue(line("two", "Crew 2 is holding.", 2));
    hub.afterStep();
    hub.disconnect(second, 2_000);
    expect(bridge.scheduler.nowPlaying?.id).toBe("one");
    expect(bridge.scheduler.pending().map((item) => item.id)).toEqual(["two"]);
  });

  it("starts the next prepared line when playback is never acknowledged", () => {
    const { bridge, hub } = setup({ playbackAckBudgetMs: () => 1_000 });
    const id = hub.connect();
    hub.drain(id);
    bridge.scheduler.enqueue(line("one", "Crew 1 is holding.", 1));
    bridge.scheduler.enqueue(line("two", "Crew 2 is holding.", 2));
    hub.afterStep();
    expect(startedIds(hub.drain(id))).toEqual(["one"]);

    bridge.pollWall(100);
    bridge.pollWall(1_099);
    hub.afterStep();
    expect(startedIds(hub.drain(id))).toEqual([]);
    bridge.pollWall(1_100);
    hub.afterStep();
    expect(startedIds(hub.drain(id))).toEqual(["two"]);
  });

  it("ignores a playback report that does not match the current clip", () => {
    const { bridge, hub } = setup();
    const id = hub.connect();
    hub.drain(id);
    bridge.scheduler.enqueue(line("one", "Crew 1 is holding.", 1));
    bridge.scheduler.enqueue(line("two", "Crew 2 is holding.", 2));
    hub.afterStep();
    hub.drain(id);
    hub.handle(id, encodeClient({ type: "speech_playback", itemId: "two", outcome: "ended" }), 1_000);
    hub.afterStep();
    expect(bridge.scheduler.nowPlaying?.id).toBe("one");
    expect(startedIds(hub.drain(id))).toEqual([]);
  });
});
