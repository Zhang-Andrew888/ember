import { describe, expect, it } from "vitest";
import { CommandGateway, ScriptedInterpreter, type Directory, type GatewayEnv } from "./index.js";

const directory: Directory = {
  agents: [
    { id: "crew-1", callsign: "Crew 1", role: "protection_crew" },
    { id: "crew-2", callsign: "Crew 2", role: "protection_crew" },
  ],
  sites: [{ id: "site-b", name: "Waterworks" }],
  locations: [],
  corridors: [],
  places: [
    { id: "n-sb", name: "Waterworks" },
    { id: "n-sa", name: "Ridge Cabins" },
    { id: "n-rw", name: "Refuge West" },
    { id: "n-h", name: "East Junction" },
    { id: "n-n", name: "North Junction" },
  ],
};

function gateway() {
  const env: GatewayEnv = {
    directory,
    interpreter: new ScriptedInterpreter(),
    picture: () => [],
    status: () => null,
    nowSimMs: () => 60_000,
    incidentEnded: () => false,
  };
  const gw = new CommandGateway(env);
  let n = 0;
  const say = (text: string) => {
    const ticket = gw.submit({ commandId: `cmd-${n}`, text, idempotencyKey: `k-${n++}`, wallMs: 0 });
    return ticket.outcomes[ticket.outcomes.length - 1]!;
  };
  const lines = (outcome: ReturnType<typeof say>) =>
    outcome.actions.flatMap((a) => (a.kind === "objective" ? [{ to: a.objective.recipientId, line: a.objective.constraints.line }] : []));
  return { say, lines };
}

const interpret = (text: string) =>
  new ScriptedInterpreter().interpret({ commandId: "c", inputSequence: 0, text, directory, activeRecipientCallsign: null });

describe("fire line orders: interpretation", () => {
  it("reads one crew's line and its starting end", () => {
    expect(interpret("Crew 1, cut a fire line from Ridge Cabins to Waterworks")?.objective).toEqual({
      kind: "line",
      fromName: "Ridge Cabins",
      toName: "Waterworks",
    });
    // "starting at" picks the end even when it is named second.
    expect(interpret("Crew 1, build a firebreak between Waterworks and Ridge Cabins, starting at Ridge Cabins")?.objective).toMatchObject({
      fromName: "Ridge Cabins",
      toName: "Waterworks",
    });
  });

  it("assigns each named crew to its own end", () => {
    const env = interpret("Crew 1 and Crew 2, cut a line between East Junction and North Junction, Crew 2 from East Junction, Crew 1 from North Junction");
    expect(env?.clarification).toBeUndefined();
    expect(env?.objective?.assignments).toEqual([
      { recipient: "Crew 1", startName: "North Junction" },
      { recipient: "Crew 2", startName: "East Junction" },
    ]);
  });

  it("splits unassigned crews across the two ends in the order named", () => {
    expect(interpret("Crew 1 and Crew 2, cut a fire line from Waterworks to Ridge Cabins")?.objective?.assignments).toEqual([
      { recipient: "Crew 1", startName: "Waterworks" },
      { recipient: "Crew 2", startName: "Ridge Cabins" },
    ]);
  });

  it("asks for the other end when only one place is named", () => {
    expect(interpret("Crew 1, cut a fire line at Waterworks")?.clarification).toMatch(/two places/);
  });

  it("leaves 'hold the line' as a containment order", () => {
    expect(interpret("Crew 1, hold the line")?.objective?.kind).not.toBe("line");
  });
});

describe("fire line orders: gateway", () => {
  it("sends one objective per crew, each starting at its own end", () => {
    const { say, lines } = gateway();
    const outcome = say("Crew 1 and Crew 2, cut a line between East Junction and North Junction, Crew 1 from East Junction, Crew 2 from North Junction");
    expect(outcome.receipt.status).toBe("accepted");
    expect(lines(outcome)).toEqual([
      { to: "crew-1", line: { fromNodeId: "n-h", toNodeId: "n-n" } },
      { to: "crew-2", line: { fromNodeId: "n-n", toNodeId: "n-h" } },
    ]);
    expect(outcome.reply).toMatch(/Crew 1: cut a fire line from East Junction toward North Junction/);
    expect(outcome.reply).toMatch(/Each crew starts on its own/);
  });

  it("sends a single crew from the end it was given", () => {
    const { say, lines } = gateway();
    const outcome = say("Crew 2, cut a fire line from Ridge Cabins to Waterworks");
    expect(lines(outcome)).toEqual([{ to: "crew-2", line: { fromNodeId: "n-sa", toNodeId: "n-sb" } }]);
  });

  it("asks again when a place is unknown", () => {
    const { say } = gateway();
    const outcome = say("Crew 1, cut a fire line from Ridge Cabins to Waterworks");
    expect(outcome.receipt.status).toBe("accepted");
    expect(say("Crew 1, cut a fire line from the quarry to Waterworks").receipt.status).toBe("clarification_required");
  });
});
