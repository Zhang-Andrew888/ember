import { z } from "zod";
import { CommandReceipt, CoordinatorView, DecisionEvent, IncidentEnd, WIRE_PROTOCOL_VERSION, WireProtocolVersion } from "@ember/domain";

/** Messages the browser may send. Everything else is rejected before it reaches the incident. */
export const ClientMessage = z.discriminatedUnion("type", [
  z.object({ type: z.literal("say"), text: z.string().min(1).max(2000), idempotencyKey: z.string().min(1).max(100) }),
  z.object({ type: z.literal("ptt_begin") }),
  z.object({ type: z.literal("ptt_release"), transcript: z.string().max(2000) }),
  z.object({ type: z.literal("ptt_lost_focus"), transcript: z.string().max(2000) }),
  z.object({ type: z.literal("resend") }),
  /** Looking at an agent on the map. It never changes who messages are addressed to. */
  z.object({ type: z.literal("inspect"), agentId: z.string().min(1).max(40) }),
  /** Browser finished playing a prepared TTS clip (Grok voice); unblocks the server speech queue. */
  z.object({ type: z.literal("audio_finished"), itemId: z.string().min(1).max(80) }),
]);
export type ClientMessage = z.infer<typeof ClientMessage>;

export const ClientWireEnvelope = z.object({
  protocolVersion: WireProtocolVersion,
  message: ClientMessage,
});
export type ClientWireEnvelope = z.infer<typeof ClientWireEnvelope>;

export const TranscriptMessage = z.object({
  type: z.literal("transcript"),
  kind: z.enum(["coordinator", "control", "agent", "system"]),
  text: z.string(),
  simTimeMs: z.number().int().nonnegative(),
  urgent: z.boolean(),
});

/**
 * Everything the server sends. Each payload is built from an already-sanitized projection (the
 * coordinator view, committed decisions, transcript lines); no world parameters, seed or
 * truth state has a field here to travel in.
 */
export const ServerMessage = z.discriminatedUnion("type", [
  z.object({ type: z.literal("view"), view: CoordinatorView }),
  TranscriptMessage,
  z.object({ type: z.literal("receipt"), receipt: CommandReceipt, reply: z.string() }),
  z.object({ type: z.literal("decision"), decision: DecisionEvent, callsign: z.string() }),
  z.object({ type: z.literal("audio"), event: z.enum(["alert", "audio_preparing", "interrupted", "started", "audio_unavailable", "dropped"]), itemId: z.string() }),
  z.object({ type: z.literal("notice"), kind: z.enum(["still_interpreting", "unsent_utterance", "technical_failure", "bad_message", "backpressure"]), detail: z.string() }),
  z.object({ type: z.literal("ended"), end: IncidentEnd }),
  z.object({ type: z.literal("inspection"), agentId: z.string(), callsign: z.string(), state: z.string(), activeRecipientId: z.string().nullable() }),
]);
export type ServerMessage = z.infer<typeof ServerMessage>;

export const ServerWireEnvelope = z.object({
  protocolVersion: WireProtocolVersion,
  message: ServerMessage,
});
export type ServerWireEnvelope = z.infer<typeof ServerWireEnvelope>;

export function encodeServer(message: ServerMessage): string {
  return JSON.stringify(
    ServerWireEnvelope.parse({
      protocolVersion: WIRE_PROTOCOL_VERSION,
      message: ServerMessage.parse(message),
    }),
  );
}

/** @deprecated Use encodeServer */
export function encode(message: ServerMessage): string {
  return encodeServer(message);
}

export function decodeClient(raw: string): ClientMessage | null {
  try {
    const data = JSON.parse(raw) as unknown;
    const wrapped = ClientWireEnvelope.safeParse(data);
    if (wrapped.success) return wrapped.data.message;
    const legacy = ClientMessage.safeParse(data);
    return legacy.success ? legacy.data : null;
  } catch {
    return null;
  }
}

export function decode(raw: string): ClientMessage | null {
  return decodeClient(raw);
}

export function parseServerWire(raw: string): ServerMessage | null {
  try {
    const data = JSON.parse(raw) as unknown;
    const wrapped = ServerWireEnvelope.safeParse(data);
    if (wrapped.success) return wrapped.data.message;
    const legacy = ServerMessage.safeParse(data);
    return legacy.success ? legacy.data : null;
  } catch {
    return null;
  }
}

export function encodeClient(message: ClientMessage): string {
  return JSON.stringify(
    ClientWireEnvelope.parse({
      protocolVersion: WIRE_PROTOCOL_VERSION,
      message: ClientMessage.parse(message),
    }),
  );
}
