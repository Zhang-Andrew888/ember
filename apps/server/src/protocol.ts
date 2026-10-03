import { z } from "zod";
import { CommandReceipt, CoordinatorView, DecisionEvent, IncidentEnd } from "@ember/domain";

/** Messages the browser may send. Everything else is rejected before it reaches the incident. */
export const ClientMessage = z.discriminatedUnion("type", [
  z.object({ type: z.literal("say"), text: z.string().min(1).max(2000), idempotencyKey: z.string().min(1).max(100) }),
  z.object({ type: z.literal("ptt_begin") }),
  z.object({ type: z.literal("ptt_release"), transcript: z.string().max(2000) }),
  z.object({ type: z.literal("ptt_lost_focus"), transcript: z.string().max(2000) }),
  z.object({ type: z.literal("resend") }),
]);
export type ClientMessage = z.infer<typeof ClientMessage>;

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
  z.object({ type: z.literal("notice"), kind: z.enum(["still_interpreting", "unsent_utterance", "technical_failure", "bad_message"]), detail: z.string() }),
  z.object({ type: z.literal("ended"), end: IncidentEnd }),
]);
export type ServerMessage = z.infer<typeof ServerMessage>;

export function encode(message: ServerMessage): string {
  return JSON.stringify(ServerMessage.parse(message));
}

export function decode(raw: string): ClientMessage | null {
  try {
    const parsed = ClientMessage.safeParse(JSON.parse(raw) as unknown);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
