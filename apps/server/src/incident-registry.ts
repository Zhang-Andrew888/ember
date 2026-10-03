import { randomBytes } from "node:crypto";
import type { CoordinatorView, IncidentEnd } from "@ember/domain";
import { buildSyntheticScenario, type SimScenario } from "@ember/simulation";
import { ConversationBridge } from "./conversation.js";
import { grokVoiceEnabled } from "./xai/env.js";
import { SpeechAudioStore } from "./xai/speech-audio-store.js";
import { LiveRun, SessionHub } from "./hub.js";
import { IncidentSession, type SessionOptions } from "./session.js";
import type { MonotonicClock } from "./runner.js";

export interface IncidentRecord {
  readonly id: string;
  readonly token: string;
  readonly session: IncidentSession;
  readonly bridge: ConversationBridge;
  readonly hub: SessionHub;
  readonly live: LiveRun;
  readonly scenario: SimScenario;
  readonly seed: string;
  started: boolean;
  readonly speechStore: SpeechAudioStore;
}

export interface CreateIncidentBody {
  readonly scenario?: SimScenario;
  readonly seed?: string;
  readonly session?: Omit<SessionOptions, "scenario" | "seed">;
}

/**
 * In-memory incident registry for the HTTP/WebSocket surface. One process, no persistence.
 */
export class IncidentRegistry {
  private readonly records = new Map<string, IncidentRecord>();
  private readonly byToken = new Map<string, string>();

  create(body: CreateIncidentBody = {}, clock: MonotonicClock): IncidentRecord {
    const id = randomBytes(12).toString("hex");
    const token = randomBytes(24).toString("hex");
    const scenario = body.scenario ?? buildSyntheticScenario();
    const seed = body.seed ?? `incident-${id}`;
    const session = new IncidentSession({ scenario, seed, ...body.session });
    const speechStore = new SpeechAudioStore();
    const grokTts = grokVoiceEnabled();
    const bridge = new ConversationBridge(session, { speechStore, grokTts });
    const hub = new SessionHub(session, bridge);
    const live = new LiveRun(session, bridge, hub, clock);
    const record: IncidentRecord = { id, token, session, bridge, hub, live, scenario, seed, started: false, speechStore };
    this.records.set(id, record);
    this.byToken.set(token, id);
    return record;
  }

  get(id: string): IncidentRecord | undefined {
    return this.records.get(id);
  }

  authorize(id: string, token: string | undefined): IncidentRecord | undefined {
    if (token === undefined) return undefined;
    const mapped = this.byToken.get(token);
    if (mapped !== id) return undefined;
    return this.records.get(id);
  }

  briefingView(record: IncidentRecord): CoordinatorView {
    return record.session.coordinatorView();
  }

  start(record: IncidentRecord): void {
    if (record.started) return;
    record.started = true;
    record.live.start();
  }

  replayPayload(record: IncidentRecord): { views: CoordinatorView[]; end: IncidentEnd | null } | null {
    if (!record.session.incident.ended) return null;
    return {
      views: [record.session.coordinatorView()],
      end: record.session.incident.end,
    };
  }

  all(): Iterable<IncidentRecord> {
    return this.records.values();
  }
}
