import { CommandReceipt, CoordinatorView, WIRE_PROTOCOL_VERSION } from "@ember/domain";

/** Mirrors apps/server/src/protocol.ts — web lane parses the same envelopes. */
export interface WireTranscript {
  readonly type: "transcript";
  readonly kind: "coordinator" | "control" | "agent" | "system";
  readonly text: string;
  readonly simTimeMs: number;
  readonly urgent: boolean;
}

export interface WireReceipt {
  readonly type: "receipt";
  readonly receipt: CommandReceipt;
  readonly reply: string;
}

export interface WireAudioCue {
  readonly type: "audio";
  readonly event:
    | "alert"
    | "audio_preparing"
    | "interrupted"
    | "started"
    | "audio_unavailable"
    | "dropped";
  readonly itemId: string;
}

export interface WireNotice {
  readonly type: "notice";
  readonly kind: "still_interpreting" | "unsent_utterance" | "technical_failure" | "bad_message" | "backpressure";
  readonly detail: string;
}

export interface WireView {
  readonly type: "view";
  readonly view: CoordinatorView;
}

export type ServerWireMessage = WireView | WireTranscript | WireReceipt | WireNotice | WireAudioCue;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseTranscript(message: Record<string, unknown>): WireTranscript | null {
  const kind = message.kind;
  if (
    message.type !== "transcript" ||
    (kind !== "coordinator" && kind !== "control" && kind !== "agent" && kind !== "system") ||
    typeof message.text !== "string" ||
    typeof message.simTimeMs !== "number" ||
    typeof message.urgent !== "boolean"
  ) {
    return null;
  }
  return {
    type: "transcript",
    kind,
    text: message.text,
    simTimeMs: message.simTimeMs,
    urgent: message.urgent,
  };
}

function parseReceipt(message: Record<string, unknown>): WireReceipt | null {
  if (message.type !== "receipt" || typeof message.reply !== "string") return null;
  const receipt = CommandReceipt.safeParse(message.receipt);
  if (!receipt.success) return null;
  return { type: "receipt", receipt: receipt.data, reply: message.reply };
}

function parseAudio(message: Record<string, unknown>): WireAudioCue | null {
  const event = message.event;
  if (
    message.type !== "audio" ||
    typeof message.itemId !== "string" ||
    (event !== "alert" &&
      event !== "audio_preparing" &&
      event !== "interrupted" &&
      event !== "started" &&
      event !== "audio_unavailable" &&
      event !== "dropped")
  ) {
    return null;
  }
  return { type: "audio", event, itemId: message.itemId };
}

function parseNotice(message: Record<string, unknown>): WireNotice | null {
  const kind = message.kind;
  if (
    message.type !== "notice" ||
    (kind !== "still_interpreting" &&
      kind !== "unsent_utterance" &&
      kind !== "technical_failure" &&
      kind !== "bad_message" &&
      kind !== "backpressure") ||
    typeof message.detail !== "string"
  ) {
    return null;
  }
  return { type: "notice", kind, detail: message.detail };
}

function parseViewMessage(message: Record<string, unknown>): WireView | null {
  if (message.type !== "view") return null;
  const view = CoordinatorView.safeParse(message.view);
  if (!view.success) return null;
  return { type: "view", view: view.data };
}

/**
 * Server message types this client deliberately does not act on (issue #52): the transcript and the
 * coordinator view already carry the same facts (`decision` is spoken through transcripts, `ended` is
 * `view.incidentEnd`), and `inspection` has no screen yet. They parse to null on purpose.
 */
export const INTENTIONALLY_IGNORED_WIRE_TYPES: readonly string[] = ["decision", "ended", "inspection"];

export function parseServerWireMessage(raw: string): ServerWireMessage | null {
  try {
    const data = JSON.parse(raw) as unknown;
    let message: unknown = data;
    if (isRecord(data) && "protocolVersion" in data && "message" in data) {
      if (data.protocolVersion !== WIRE_PROTOCOL_VERSION) return null;
      message = data.message;
    }
    if (!isRecord(message)) {
      const legacyView = parseLegacyCoordinatorView(data);
      return legacyView ? { type: "view", view: legacyView } : null;
    }
    return (
      parseViewMessage(message) ??
      parseTranscript(message) ??
      parseReceipt(message) ??
      parseNotice(message) ??
      parseAudio(message)
    );
  } catch {
    return null;
  }
}

function parseLegacyCoordinatorView(data: unknown): CoordinatorView | null {
  const direct = CoordinatorView.safeParse(data);
  if (direct.success) return direct.data;
  if (isRecord(data) && "view" in data) {
    const legacy = CoordinatorView.safeParse(data.view);
    if (legacy.success) return legacy.data;
  }
  return null;
}

export function encodeServerWireMessage(message: ServerWireMessage): string {
  return JSON.stringify({
    protocolVersion: WIRE_PROTOCOL_VERSION,
    message,
  });
}
