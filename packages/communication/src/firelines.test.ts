import { describe, expect, it } from "vitest";
import { CommandGateway, ScriptedInterpreter, type Directory, type GatewayEnv, type Interpreter } from "./index.js";
import { spokenToDigits } from "./line-order.js";

const directory: Directory = {
  agents: [
    { id: "crew-1", callsign: "Crew 1", role: "protection_crew" },
    { id: "crew-2", callsign: "Crew 2", role: "protection_crew" },
    { id: "crew-3", callsign: "Crew 3", role: "protection_crew" },
  ],
  sites: [{ id: "site-b", name: "Waterworks" }],
  locations: [],
  corridors: [],
  places: [
    { id: "n-sb", name: "Waterworks", x: 400, y: 1200 },
    { id: "n-sa", name: "Ridge Cabins", x: 1300, y: 1100 },
    { id: "n-rw", name: "Refuge West", x: 100, y: 800 },
    { id: "n-h", name: "East Junction", x: 800, y: 600 },
    { id: "n-n", name: "North Junction", x: 800, y: 900 },
  ],
};

const interpret = (text: string) =>
  new ScriptedInterpreter().interpret({ commandId: "c", inputSequence: 0, text, directory, activeRecipientCallsign: null });

describe("spoken numbers", () => {
  it("reads cardinals as digits", () => {
    expect(spokenToDigits("two hundred meters")).toBe("200 meters");
    expect(spokenToDigits("one hundred and fifty m")).toBe("150 m");
    expect(spokenToDigits("fifteen hundred meters")).toBe("1500 meters");
    expect(spokenToDigits("a hundred meters")).toBe("100 meters");
    expect(spokenToDigits("four hundred fifty-five meters")).toBe("455 meters");
    expect(spokenToDigits("two thousand five hundred")).toBe("2500");
    expect(spokenToDigits("Crew one and crew two")).toBe("crew 1 and crew 2");
  });

  it("reads digit runs after 'bearing' as a bearing", () => {
    expect(spokenToDigits("bearing zero three zero")).toBe("bearing 030");
    expect(spokenToDigits("bearing one eight zero for four hundred meters")).toBe("bearing 180 for 400 meters");
    expect(spokenToDigits("bearing three sixty")).toBe("bearing 360");
    expect(spokenToDigits("bearing oh four five")).toBe("bearing 045");
    expect(spokenToDigits("bearing thirty")).toBe("bearing 30");
  });

  it("leaves everything else alone", () => {
    expect(spokenToDigits("Cut a line to the edge, then hold.")).toBe("cut a line to the edge, then hold.");
  });
});

describe("fire line orders: the table in FIREBREAK_PLAN 2.4", () => {
  it("row 1: from a place to a place, one crew", () => {
    const env = interpret("Crew 1, cut line from Waterworks to Ridge Cabins.");
    expect(env?.clarification).toBeUndefined();
    expect(env?.explicitRecipient).toBe("Crew 1");
    expect(env?.objective).toEqual({
      kind: "line",
      anchor: { placeName: "Waterworks" },
      course: { kind: "to_place", placeName: "Ridge Cabins" },
    });
  });

  it("row 2: anchor at a place, north to the edge", () => {
    const env = interpret("Crew 1, anchor at East Junction and cut line north to the edge.");
    expect(env?.clarification).toBeUndefined();
    expect(env?.explicitRecipient).toBe("Crew 1");
    expect(env?.objective).toEqual({
      kind: "line",
      anchor: { placeName: "East Junction" },
      course: { kind: "heading", direction: "north", toEdge: true },
    });
  });

  it("row 3: an offset anchor, a direction and length, and a compass end for each crew", () => {
    const env = interpret(
      "Crew 1 and Crew 2, cut line from 200 m west of East Junction, 500 m north. Crew 1 on the south end, Crew 2 on the north end.",
    );
    expect(env?.clarification).toBeUndefined();
    expect(env?.objective).toEqual({
      kind: "line",
      anchor: { placeName: "East Junction", offsetMeters: 200, offsetDirection: "west" },
      course: { kind: "heading", direction: "north", lengthMeters: 500 },
      crews: [
        { recipient: "Crew 1", end: { compass: "south" } },
        { recipient: "Crew 2", end: { compass: "north" } },
      ],
    });
  });

  it("row 4: an offset anchor and a bearing with a length", () => {
    const env = interpret("Crew 1, start 150 meters north of Waterworks, cut line bearing 030 for 400 meters.");
    expect(env?.clarification).toBeUndefined();
    expect(env?.explicitRecipient).toBe("Crew 1");
    expect(env?.objective).toEqual({
      kind: "line",
      anchor: { placeName: "Waterworks", offsetMeters: 150, offsetDirection: "north" },
      course: { kind: "heading", bearingDeg: 30, lengthMeters: 400 },
    });
  });

  it("row 5: two crews without ends take the start and the far end in the order named", () => {
    const env = interpret("Crew 1 and Crew 2, cut line from Waterworks to Ridge Cabins, work toward each other.");
    expect(env?.clarification).toBeUndefined();
    expect(env?.objective).toEqual({
      kind: "line",
      anchor: { placeName: "Waterworks" },
      course: { kind: "to_place", placeName: "Ridge Cabins" },
      crews: [
        { recipient: "Crew 1", end: "start" },
        { recipient: "Crew 2", end: "far" },
      ],
    });
  });

  it("'hold the line' stays a containment order", () => {
    for (const text of ["Crew 1, hold the line", "Crew 1, hold the line at the east corridor"]) {
      const env = interpret(text);
      expect(env?.objective?.kind).toBe("contain");
    }
  });
});

describe("fire line orders: more forms", () => {
  it("reads spoken lengths and bearings", () => {
    expect(
      interpret("Crew one, start one hundred fifty meters north of Waterworks, cut line bearing zero three zero for four hundred meters")?.objective,
    ).toEqual({
      kind: "line",
      anchor: { placeName: "Waterworks", offsetMeters: 150, offsetDirection: "north" },
      course: { kind: "heading", bearingDeg: 30, lengthMeters: 400 },
    });
    expect(interpret("Crew 2, cut a line from East Junction east two hundred meters")?.objective?.course).toEqual({
      kind: "heading",
      direction: "east",
      lengthMeters: 200,
    });
  });

  it("leaves the length out when none is given, so the gateway uses its default", () => {
    expect(interpret("Crew 1, cut line from East Junction heading north")?.objective).toEqual({
      kind: "line",
      anchor: { placeName: "East Junction" },
      course: { kind: "heading", direction: "north" },
    });
  });

  it("does not mistake 'to the north' for a place", () => {
    expect(interpret("Crew 1, cut line to the north from Refuge West, five hundred meters")?.objective).toEqual({
      kind: "line",
      anchor: { placeName: "Refuge West" },
      course: { kind: "heading", direction: "north", lengthMeters: 500 },
    });
  });

  it("takes a diagonal direction and a distance in kilometers", () => {
    expect(interpret("Crew 1, cut line from Refuge West north-east 0.5 kilometers")?.objective?.course).toEqual({
      kind: "heading",
      direction: "northeast",
      lengthMeters: 500,
    });
  });

  it("reads a crew's own place end", () => {
    const env = interpret("Crew 1 and Crew 2, cut a line between East Junction and North Junction, Crew 2 from East Junction, Crew 1 from North Junction");
    expect(env?.clarification).toBeUndefined();
    expect(env?.objective?.crews).toEqual([
      { recipient: "Crew 1", end: { placeName: "North Junction" } },
      { recipient: "Crew 2", end: { placeName: "East Junction" } },
    ]);
    expect(env?.objective?.anchor).toEqual({ placeName: "East Junction" });
    expect(env?.objective?.course).toEqual({ kind: "to_place", placeName: "North Junction" });
  });

  it("reads 'start' and 'far end' for a crew", () => {
    const env = interpret("Crew 2 and Crew 1, cut line from Waterworks to Ridge Cabins. Crew 1 on the start, Crew 2 on the far end.");
    expect(env?.objective?.crews).toEqual([
      { recipient: "Crew 2", end: "far" },
      { recipient: "Crew 1", end: "start" },
    ]);
  });

  it("lets 'starting at' choose the anchor even when it is named second", () => {
    expect(interpret("Crew 1, build a firebreak between Waterworks and Ridge Cabins, starting at Ridge Cabins")?.objective).toEqual({
      kind: "line",
      anchor: { placeName: "Ridge Cabins" },
      course: { kind: "to_place", placeName: "Waterworks" },
    });
  });

  it("passes an unknown place on by name", () => {
    expect(interpret("Crew 1, cut a fire line from the quarry to Waterworks")?.objective).toEqual({
      kind: "line",
      anchor: { placeName: "quarry" },
      course: { kind: "to_place", placeName: "Waterworks" },
    });
    expect(interpret("Crew 1, cut a fire line from Waterworks to the old mill")?.objective?.course).toEqual({ kind: "to_place", placeName: "old mill" });
  });

  it("leaves a missing course or anchor to the gateway", () => {
    expect(interpret("Crew 1, cut a fire line at Waterworks")?.objective).toEqual({ kind: "line", anchor: { placeName: "Waterworks" } });
    expect(interpret("Crew 1, cut a fire line north 300 meters")?.objective).toEqual({
      kind: "line",
      course: { kind: "heading", direction: "north", lengthMeters: 300 },
    });
  });

  it("does not accept screen words for an end", () => {
    for (const text of [
      "Crew 1 and Crew 2, cut line from Waterworks to Ridge Cabins, Crew 1 on the top end, Crew 2 on the bottom end",
      "Crew 1, cut line from East Junction to the top of the screen",
      "Crew 1, cut line from East Junction to the left edge",
    ]) {
      expect(interpret(text)?.clarification).toMatch(/can't see your screen/);
    }
  });

  it("asks when it cannot tell what to read", () => {
    expect(interpret("Crew 1, cut line from East Junction north then east 200 meters")?.clarification).toMatch(/single compass direction/);
    expect(interpret("Crew 1, cut line from East Junction bearing 450")?.clarification).toMatch(/0 to 360/);
    expect(interpret("Crew 1, cut line from East Junction north 200 meters or 500 meters")?.clarification).toMatch(/How long/);
    expect(interpret("Crew 1 and Crew 2, cut line from Waterworks to Ridge Cabins, Crew 1 on the far end")?.clarification).toMatch(/Crew 2/);
    expect(interpret("Crew 1, cut line from Waterworks to 200 m east of Ridge Cabins")?.clarification).toMatch(/offset/);
  });
});

function gateway(options: { ended?: boolean } = {}) {
  const env: GatewayEnv = {
    directory,
    interpreter: new ScriptedInterpreter(),
    picture: () => [],
    status: () => null,
    nowSimMs: () => 60_000,
    incidentEnded: () => options.ended ?? false,
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

describe("fire line orders: gateway", () => {
  it("row 1: a line between two places, from the crew's place", () => {
    const { say, lines } = gateway();
    const outcome = say("Crew 1, cut line from Waterworks to Ridge Cabins.");
    expect(outcome.receipt.status).toBe("accepted");
    expect(lines(outcome)).toEqual([{ to: "crew-1", line: { start: { x: 400, y: 1200 }, end: { x: 1300, y: 1100 } } }]);
    expect(outcome.reply).toMatch(/^Sent to Crew 1: cut line from the west end \(Waterworks\) toward the east end \(Ridge Cabins, 906 m\)\./);
  });

  it("uses 200 m when no length is given", () => {
    const { say, lines } = gateway();
    const outcome = say("Crew 1, cut line from East Junction heading north");
    expect(lines(outcome)).toEqual([{ to: "crew-1", line: { start: { x: 800, y: 600 }, end: { x: 800, y: 800 } } }]);
    expect(outcome.reply).toContain("(200 m)");
  });

  it("row 2: north to the edge ends exactly at the map edge, without saying it was shortened", () => {
    const { say, lines } = gateway();
    const outcome = say("Crew 1, anchor at East Junction and cut line north to the edge.");
    expect(lines(outcome)).toEqual([{ to: "crew-1", line: { start: { x: 800, y: 600 }, end: { x: 800, y: 1600 } } }]);
    expect(outcome.reply).toContain("(1000 m)");
    expect(outcome.reply).not.toMatch(/shortened/);
  });

  it("shortens a line that would leave the map and says so", () => {
    const { say, lines } = gateway();
    const outcome = say("Crew 2, cut line from North Junction north 800 meters");
    expect(lines(outcome)).toEqual([{ to: "crew-2", line: { start: { x: 800, y: 900 }, end: { x: 800, y: 1600 } } }]);
    expect(outcome.reply).toBe(
      "Sent to Crew 2: cut line from the south end (North Junction) toward the north end (700 m, shortened at the map edge). Its own feasibility check decides.",
    );
  });

  it("row 3: two crews on named compass ends, each starting at its own end", () => {
    const { say, lines } = gateway();
    const outcome = say(
      "Crew 1 and Crew 2, cut line from 200 m west of East Junction, 500 m north. Crew 1 on the south end, Crew 2 on the north end.",
    );
    expect(outcome.receipt.status).toBe("accepted");
    expect(lines(outcome)).toEqual([
      { to: "crew-1", line: { start: { x: 600, y: 600 }, end: { x: 600, y: 1100 } } },
      { to: "crew-2", line: { start: { x: 600, y: 1100 }, end: { x: 600, y: 600 } } },
    ]);
    const [one, two, note] = outcome.reply.split("\n");
    expect(one).toBe("Sent to Crew 1: cut line from the south end (200 m west of East Junction) toward the north end (500 m).");
    expect(two).toBe("Sent to Crew 2: cut line from the north end toward the south end (200 m west of East Junction, 500 m).");
    expect(note).toMatch(/Each crew starts on its own/);
  });

  it("row 4: an offset anchor and a bearing", () => {
    const { say, lines } = gateway();
    const outcome = say("Crew 1, start 150 meters north of Refuge West, cut line bearing 030 for 400 meters.");
    const line = lines(outcome)[0]?.line;
    expect(line?.start).toEqual({ x: 100, y: 950 });
    // Bearing 030: 400 m at 30 degrees east of north.
    expect(line?.end.x).toBeCloseTo(100 + 200, 6);
    expect(line?.end.y).toBeCloseTo(950 + 346.4101615, 4);
    expect(outcome.reply).toBe(
      "Sent to Crew 1: cut line from the southwest end (150 m north of Refuge West) toward the northeast end (400 m). Its own feasibility check decides.",
    );
  });

  it("row 4 as written: the same order from Waterworks runs into the map edge and is shortened", () => {
    const { say, lines } = gateway();
    const outcome = say("Crew 1, start 150 meters north of Waterworks, cut line bearing 030 for 400 meters.");
    const line = lines(outcome)[0]?.line;
    expect(line?.start).toEqual({ x: 400, y: 1350 });
    expect(line?.end.y).toBeCloseTo(1600, 6);
    expect(line?.end.x).toBeCloseTo(400 + 250 * Math.tan(Math.PI / 6), 6);
    expect(outcome.reply).toMatch(/shortened at the map edge/);
  });

  it("row 5: two crews without ends take the start and the far end in the order named", () => {
    const { say, lines } = gateway();
    const outcome = say("Crew 2 and Crew 1, cut line from Waterworks to Ridge Cabins, work toward each other.");
    expect(lines(outcome)).toEqual([
      { to: "crew-2", line: { start: { x: 400, y: 1200 }, end: { x: 1300, y: 1100 } } },
      { to: "crew-1", line: { start: { x: 1300, y: 1100 }, end: { x: 400, y: 1200 } } },
    ]);
  });

  it("sends a crew told to start at the far place from that place", () => {
    const { say, lines } = gateway();
    const outcome = say("Crew 1 and Crew 2, cut a line between East Junction and North Junction, Crew 1 from East Junction, Crew 2 from North Junction");
    expect(lines(outcome)).toEqual([
      { to: "crew-1", line: { start: { x: 800, y: 600 }, end: { x: 800, y: 900 } } },
      { to: "crew-2", line: { start: { x: 800, y: 900 }, end: { x: 800, y: 600 } } },
    ]);
  });

  it("asks which end when a compass end is ambiguous", () => {
    const { say, lines } = gateway();
    const outcome = say("Crew 1 and Crew 2, cut line from East Junction east 300 meters. Crew 1 on the north end, Crew 2 on the south end.");
    expect(outcome.receipt.status).toBe("clarification_required");
    expect(lines(outcome)).toEqual([]);
    expect(outcome.reply).toMatch(/has no north end/);
    expect(outcome.reply).toMatch(/the west end or the east end/);
  });

  it("asks when an unknown place is named", () => {
    const { say, lines } = gateway();
    const outcome = say("Crew 1, cut a fire line from the quarry to Waterworks");
    expect(outcome.receipt.status).toBe("clarification_required");
    expect(outcome.reply).toBe("I don't know a place called quarry.");
    expect(lines(outcome)).toEqual([]);
    const course = say("Crew 1, cut a fire line from Waterworks to the old mill");
    expect(course.reply).toBe("I don't know a place called old mill.");
  });

  it("asks when the course is missing", () => {
    const { say } = gateway();
    const outcome = say("Crew 1, cut a fire line at Waterworks");
    expect(outcome.receipt.status).toBe("clarification_required");
    expect(outcome.reply).toMatch(/Where should the line go/);
    expect(say("Crew 1, cut a fire line from Waterworks 300 meters").reply).toMatch(/Which way/);
  });

  it("asks when the anchor is missing", () => {
    const { say } = gateway();
    expect(say("Crew 1, cut a fire line north 300 meters").reply).toMatch(/Where should the line start/);
  });

  it("asks when the anchor is off the map", () => {
    const { say, lines } = gateway();
    const outcome = say("Crew 1, cut line from 200 m west of Refuge West, 300 m north");
    expect(outcome.receipt.status).toBe("clarification_required");
    expect(outcome.reply).toMatch(/off the map/);
    expect(lines(outcome)).toEqual([]);
  });

  it("asks when there is no line to cut", () => {
    const { say } = gateway();
    // Anchored on the map edge and running outward: there is nowhere to cut.
    expect(say("Crew 1, cut line from 1000 m north of East Junction heading north").reply).toMatch(/no room/);
    // A model can name the same place at both ends; the scripted parser never does.
    const stub: Interpreter = {
      interpret: (req) => ({
        commandId: req.commandId,
        inputSequence: req.inputSequence,
        kind: "objective",
        explicitRecipient: "Crew 1",
        objective: { kind: "line", anchor: { placeName: "East Junction" }, course: { kind: "to_place", placeName: "East Junction" } },
        evidenceQueries: [],
        unsupportedClaims: [],
      }),
    };
    const gw = new CommandGateway({ directory, interpreter: stub, picture: () => [], status: () => null, nowSimMs: () => 0, incidentEnded: () => false });
    const out = gw.submit({ commandId: "c", text: "x", idempotencyKey: "k", wallMs: 0 }).outcomes[0]!;
    expect(out.receipt.status).toBe("clarification_required");
    expect(out.reply).toMatch(/two different points/);
  });

  it("asks for a crew when none is named and none is active", () => {
    const { say } = gateway();
    expect(say("Cut line from Waterworks to Ridge Cabins").reply).toMatch(/Which crew/);
  });

  it("asks when an assigned place is not an end of the line", () => {
    const { say } = gateway();
    const outcome = say("Crew 1 and Crew 2, cut line from Waterworks to Ridge Cabins, Crew 1 from Refuge West, Crew 2 from Ridge Cabins");
    expect(outcome.receipt.status).toBe("clarification_required");
    expect(outcome.reply).toMatch(/Refuge West is not an end of this line/);
  });

  it("asks when two crews would take the same end, or three are named", () => {
    const { say } = gateway();
    expect(say("Crew 1 and Crew 2, cut line from Waterworks to Ridge Cabins, Crew 1 on the start, Crew 2 on the start").reply).toMatch(/same end/);
    expect(say("Crew 1, Crew 2 and Crew 3, cut line from Waterworks to Ridge Cabins").reply).toMatch(/at most two crews/);
  });

  it("keeps a containment order out of the line path", () => {
    const { say, lines } = gateway();
    const outcome = say("Crew 1, hold the line");
    expect(lines(outcome)).toEqual([]);
  });
});
