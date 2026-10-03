import { describe, expect, it } from "vitest";
import { DEFAULT_FORECAST_CONFIG } from "@ember/forecast";
import { buildSyntheticScenario } from "@ember/simulation";
import { cellIndexOf } from "@ember/simulation/model";
import { settleGrokCapture } from "../../web/src/net/settleGrokCapture.js";
import { dispatchPttRelease } from "../../web/src/net/pttRelease.js";
import { encodeClient } from "../../web/src/net/wireProtocol.js";
import { ConversationBridge } from "./conversation.js";
import { LiveRun, SessionHub } from "./hub.js";
import { parseServerWire, type ServerMessage } from "./protocol.js";
import { IncidentSession } from "./session.js";
import { ViewRecorder } from "./view-recorder.js";

const patch = (x: number, y: number): number[] => [
  cellIndexOf(x, y)!,
  cellIndexOf(x + 25, y)!,
  cellIndexOf(x, y + 25)!,
  cellIndexOf(x + 25, y + 25)!,
];

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

function setup() {
  const base = buildSyntheticScenario();
  const scenario = { ...base, map: { ...base.map, initialFireCells: patch(230, 1100) } };
  const session = new IncidentSession({
    scenario,
    seed: "SECRET-SEED-XYZ-9183",
    overrides: { spreadMultiplier: 1.3737373, windShiftMs: 333_000, initialWindRad: 0.1234567 },
    controllerConfig: { forecast: steady },
  });
  const bridge = new ConversationBridge(session);
  const hub = new SessionHub(session, bridge, new ViewRecorder());
  const live = new LiveRun(session, bridge, hub, new FakeClock());
  return { hub, bridge, live };
}

function messages(raw: readonly string[]): ServerMessage[] {
  return raw.map((frame) => {
    const message = parseServerWire(frame);
    if (message === null) throw new Error("server frame did not match the wire schema");
    return message;
  });
}

function liveSender(frames: string[]) {
  return {
    sendCommand(message: Parameters<typeof encodeClient>[0]) {
      frames.push(encodeClient(message));
    },
  };
}

describe("push-to-talk when speech-to-text fails", () => {
  it("closes server recording when transcription rejects and does not submit a command", async () => {
    const { hub, bridge, live } = setup();
    const id = hub.connect();
    live.start();
    hub.drain(id);
    hub.handle(id, encodeClient({ type: "ptt_begin" }), 1000);
    expect(bridge.scheduler.isRecording).toBe(true);

    const frames: string[] = [];
    const audio = { byteLength: 4 };
    const result = await settleGrokCapture({
      stop: () => Promise.resolve(audio),
      transcribe: () => Promise.reject(new Error("network down")),
      onRelease(text) {
        dispatchPttRelease({
          transcript: text,
          live: liveSender(frames),
          mockMode: false,
          dispatchSay(sayText) {
            frames.push(encodeClient({ type: "say", text: sayText, idempotencyKey: "say-after-ptt" }));
          },
        });
      },
      onCancel() {
        frames.push(encodeClient({ type: "ptt_lost_focus", transcript: "" }));
      },
    });

    expect(result).toEqual({ status: "failed" });
    expect(frames).toEqual([encodeClient({ type: "ptt_lost_focus", transcript: "" })]);
    for (const frame of frames) hub.handle(id, frame, 3000);
    expect(bridge.scheduler.isRecording).toBe(false);
    live.pump();
    const parsed = messages(hub.drain(id));
    expect(parsed.filter((message) => message.type === "receipt")).toHaveLength(0);
    expect(parsed.filter((message) => message.type === "transcript" && message.kind === "coordinator")).toHaveLength(0);
  });

  it("sends only ptt_release when transcription succeeds", async () => {
    const { hub, bridge, live } = setup();
    const id = hub.connect();
    live.start();
    hub.drain(id);
    const transcript = "Crew 2, hold position";
    hub.handle(id, encodeClient({ type: "ptt_begin" }), 1000);
    expect(bridge.scheduler.isRecording).toBe(true);

    const frames: string[] = [];
    const result = await settleGrokCapture({
      stop: () => Promise.resolve({ byteLength: 4 }),
      transcribe: () => Promise.resolve(transcript),
      onRelease(text) {
        dispatchPttRelease({
          transcript: text,
          live: liveSender(frames),
          mockMode: false,
          dispatchSay(sayText) {
            frames.push(encodeClient({ type: "say", text: sayText, idempotencyKey: "say-after-ptt" }));
          },
        });
      },
      onCancel() {
        frames.push(encodeClient({ type: "ptt_lost_focus", transcript: "" }));
      },
    });

    expect(result).toEqual({ status: "released" });
    expect(frames).toHaveLength(1);
    expect(frames[0]).toBe(encodeClient({ type: "ptt_release", transcript }));
    for (const frame of frames) hub.handle(id, frame, 3000);
    expect(bridge.scheduler.isRecording).toBe(false);
    live.pump();
    const parsed = messages(hub.drain(id));
    const receipts = parsed.filter((message) => message.type === "receipt");
    const coordinatorLines = parsed.filter((message) => message.type === "transcript" && message.kind === "coordinator");
    expect(receipts).toHaveLength(1);
    expect(receipts[0]).toMatchObject({ receipt: { status: "accepted", recipientId: "crew-2" } });
    expect(coordinatorLines).toHaveLength(1);
    expect(coordinatorLines[0]).toMatchObject({ text: transcript });
  });
});
