import { describe, expect, it } from "vitest";
import { INCIDENT_WS_PROTOCOL, incidentTokenFromProtocols, incidentWebSocketProtocols } from "./websocket-auth.js";

const token = "a".repeat(48);
const credential = `ember.token.${token}`;

describe("incident WebSocket authentication offers", () => {
  it("round trips a token in either offer order, with the fixed public protocol", () => {
    expect(incidentWebSocketProtocols(token)).toEqual([INCIDENT_WS_PROTOCOL, credential]);
    expect(incidentTokenFromProtocols(`${INCIDENT_WS_PROTOCOL}, ${credential}`)).toBe(token);
    expect(incidentTokenFromProtocols(`${credential}, ${INCIDENT_WS_PROTOCOL}`)).toBe(token);
  });

  it.each([
    undefined, [INCIDENT_WS_PROTOCOL, credential], "", INCIDENT_WS_PROTOCOL, credential,
    `${INCIDENT_WS_PROTOCOL}, ${INCIDENT_WS_PROTOCOL}`,
    `${credential}, ${credential}`,
    `${INCIDENT_WS_PROTOCOL}, ${credential}, ${credential}`,
    `ember.v2, ${credential}`,
    `${INCIDENT_WS_PROTOCOL}, ember.token.short`,
    `${INCIDENT_WS_PROTOCOL}, ember.token.${"A".repeat(48)}`,
    `${INCIDENT_WS_PROTOCOL}, ember.token.${token}suffix`,
    `${INCIDENT_WS_PROTOCOL}, ${credential}, other`,
  ])("rejects malformed or ambiguous offers: %j", (header) => {
    expect(incidentTokenFromProtocols(header)).toBeUndefined();
  });

  it("rejects invalid credentials without including them in errors", () => {
    expect(() => incidentWebSocketProtocols(`${token}\n`)).toThrow("Invalid incident WebSocket token");
    expect(() => incidentWebSocketProtocols("secret-invalid-token")).toThrow("Invalid incident WebSocket token");
  });
});
