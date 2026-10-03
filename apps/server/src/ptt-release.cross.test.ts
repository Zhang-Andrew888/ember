import { describe, expect, it } from "vitest";
import { DEFAULT_FORECAST_CONFIG } from "@ember/forecast";
import { buildSyntheticScenario } from "@ember/simulation";
import { cellIndexOf } from "@ember/simulation/model";
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
  return { hub, live };
}

function messages(raw: readonly string[]): ServerMessage[] {
  return raw.map((frame) => {
    const message = parseServerWire(frame);
    if (message === null) throw new Error("server frame did not match the wire schema");
    return message;
  });
}

describe("push-to-talk release across web and server", () => {
  it("plays the local mock reply only in mock mode", () => {
    const said: string[] = [];
    dispatchPttRelease({
      transcript: "Crew 2, hold position",
      live: null,
      mockMode: true,
      dispatchSay: (text) => said.push(text),
    });
    expect(said).toEqual(["Crew 2, hold position"]);

    dispatchPttRelease({
      transcript: "Crew 2, hold position",
      live: null,
      mockMode: false,
      dispatchSay: (text) => said.push(text),
    });
    expect(said).toEqual(["Crew 2, hold position"]);
  });

  it("submits one server receipt and one coordinator line for a single release", () => {
    const { hub, live } = setup();
    const id = hub.connect();
    live.start();
    hub.drain(id);

    const transcript = "Crew 2, hold position";
    const frames: string[] = [];
    hub.handle(id, encodeClient({ type: "ptt_begin" }), 1000);
    dispatchPttRelease({
      transcript,
      live: {
        sendCommand(message) {
          frames.push(encodeClient(message));
        },
      },
      mockMode: false,
      dispatchSay(text) {
        frames.push(encodeClient({ type: "say", text, idempotencyKey: "say-after-ptt" }));
      },
    });

    expect(frames).toHaveLength(1);
    for (const frame of frames) hub.handle(id, frame, 3000);
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
