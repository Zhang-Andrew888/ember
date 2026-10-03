import { describe, it, expect } from "vitest";
import { INTENTIONALLY_IGNORED_WIRE_TYPES, parseServerWireMessage } from "./serverWireParse.js";

describe("net/serverWireParse", () => {
  it("parses protocol v1 view and receipt envelopes", () => {
    const viewLine =
      '{"protocolVersion":1,"message":{"type":"view","view":{"protocolVersion":1,"sequence":0,"simTimeMs":0,"wallElapsedMs":0,"incidentStatus":"active","activeRecipientId":null,"agents":[],"sites":[],"observedCells":[],"agentPlans":[],"coordinatorForecast":null,"recentReports":[],"incidentEnd":null}}}';
    expect(parseServerWireMessage(viewLine)?.type).toBe("view");

    const noticeLine =
      '{"protocolVersion":1,"message":{"type":"notice","kind":"bad_message","detail":"Message was not understood and was ignored."}}';
    expect(parseServerWireMessage(noticeLine)?.type).toBe("notice");
  });

  it("deliberately ignores decision, ended and inspection messages", () => {
    for (const type of INTENTIONALLY_IGNORED_WIRE_TYPES) {
      expect(parseServerWireMessage(JSON.stringify({ protocolVersion: 1, message: { type, simTimeMs: 1 } }))).toBeNull();
    }
    expect([...INTENTIONALLY_IGNORED_WIRE_TYPES].sort()).toEqual(["decision", "ended", "inspection"]);
  });
});
