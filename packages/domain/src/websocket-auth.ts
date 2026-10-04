import { z } from "zod";

/** Only the public protocol is negotiated; the credential offer is never echoed. */
export const INCIDENT_WS_PROTOCOL = "ember.v1";
const TOKEN_PREFIX = "ember.token.";
const IncidentTokenSchema = z.string().length(48).regex(/^[0-9a-f]{48}$/);
const ProtocolOffersSchema = z.array(z.string()).length(2);

/** Browser WebSocket cannot send custom headers, so carry auth in a protocol offer. */
export function incidentWebSocketProtocols(token: string): string[] {
  if (!IncidentTokenSchema.safeParse(token).success) {
    throw new Error("Invalid incident WebSocket token");
  }
  return [INCIDENT_WS_PROTOCOL, `${TOKEN_PREFIX}${token}`];
}

/** Reject ambiguous, duplicate, unsupported, and malformed offers before upgrading. */
export function incidentTokenFromProtocols(header: unknown): string | undefined {
  if (typeof header !== "string") return undefined;
  const parsed = ProtocolOffersSchema.safeParse(header.split(",").map((part) => part.trim()));
  if (!parsed.success) return undefined;
  const offers = parsed.data;
  if (offers.filter((offer) => offer === INCIDENT_WS_PROTOCOL).length !== 1) return undefined;
  const credential = offers.find((offer) => offer.startsWith(TOKEN_PREFIX));
  if (credential === undefined) return undefined;
  const token = IncidentTokenSchema.safeParse(credential.slice(TOKEN_PREFIX.length));
  return token.success ? token.data : undefined;
}
