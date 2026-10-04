import { describe, expect, it, vi } from "vitest";
import { AgentId, NodeId, Objective, ObjectiveId, SequenceNumber, type MapPoint } from "@ember/domain";
import { Incident, buildSyntheticScenario, type SimScenario } from "@ember/simulation";
import { RoadIndex, cellIndexOf, firelineId } from "@ember/simulation/model";
import { firelineTarget } from "@ember/navigation";
import { CrewController, runControllers } from "./index.js";
import { lineEndWords } from "./line-words.js";

// Full simulated runs and cold forecast rollouts are slow on shared CI machines.
vi.setConfig({ testTimeout: 120_000 });

const crew1 = AgentId.parse("crew-1");
const crew2 = AgentId.parse("crew-2");
const J1 = NodeId.parse("n-j1");
const HJ = NodeId.parse("n-h");
const calm = { spreadMultiplier: 0.6, windShiftMs: 1e9, initialWindRad: 0 };

function farFireScenario(agents = ["crew-1"]): SimScenario {
  const base = buildSyntheticScenario({ agents, sites: ["site-a"] });
  return { ...base, map: { ...base.map, initialFireCells: [cellIndexOf(30, 1500)!, cellIndexOf(55, 1500)!] } };
}

const nodePoint = (node: NodeId): MapPoint => {
  const p = new RoadIndex(farFireScenario().map).nodePoint(node);
  return { x: p.x, y: p.y };
};

const lineObjective = (recipient: AgentId, start: MapPoint, end: MapPoint, id = "obj-line"): Objective =>
  Objective.parse({
    id: ObjectiveId.parse(id),
    recipientId: recipient,
    kind: "build_line",
    targetId: null,
    constraints: { line: { start, end } },
    issueSequence: SequenceNumber.parse(1),
  });

const crew = (scenario: SimScenario, agentId: AgentId, callsign: string): CrewController =>
  new CrewController({ agentId, callsign, role: "protection_crew", map: scenario.map });

/** A line that runs north-south ending at East Junction, so its north end is the crew's. */
const northEnd: MapPoint = { x: 1000, y: 1100 };

describe("line end words", () => {
  const a = { x: 100, y: 100 };
  const north = { x: 100, y: 900 };
  const east = { x: 900, y: 100 };

  it("names the crew's end by compass and the far end by place or by the opposite end", () => {
    expect(lineEndWords(north, a, "East Junction")).toEqual({ own: "the north end", far: "East Junction" });
    expect(lineEndWords(a, north, null)).toEqual({ own: "the south end", far: "the north end" });
    expect(lineEndWords(east, a, null)).toEqual({ own: "the east end", far: "the west end" });
    expect(lineEndWords(a, east, null)).toEqual({ own: "the west end", far: "the east end" });
  });

  it("uses diagonal compass points for a diagonal line", () => {
    expect(lineEndWords({ x: 900, y: 900 }, a, null).own).toBe("the northeast end");
    expect(lineEndWords(a, { x: 900, y: 900 }, null).far).toBe("the northeast end");
  });
});

describe("fire line objectives", () => {
  it("cuts the ordered line and says which end it works, in plain words", () => {
    const scenario = farFireScenario();
    const inc = new Incident({ scenario, seed: "line-order", overrides: calm });
    const c = crew(scenario, crew1, "Crew 1");
    c.receiveObjective(lineObjective(crew1, northEnd, nodePoint(HJ)));
    const log = runControllers(inc, [c], 600_000);
    const accepted = log.decisions.find((d) => d.event.reasonCode === "objective_accepted");
    expect(accepted?.event.actualAction).toMatch(/cutting line from the north end toward East Junction/);
    for (const d of log.decisions) expect(d.event.actualAction).not.toMatch(/\bn-[a-z0-9]+\b|line:|\d{3,}\s*,\s*\d{3,}|\(\s*\d+(\.\d+)?\s*,/);
    const view = inc.projectCoordinator();
    expect(view.firelines?.[0]?.id).toBe(firelineId(northEnd, nodePoint(HJ)));
    expect(view.firebreakCells?.length ?? 0).toBeGreaterThan(5);
  });

  it("names a far end with no place nearby as the opposite end", () => {
    const scenario = farFireScenario();
    const inc = new Incident({ scenario, seed: "line-unnamed-end", overrides: calm });
    const c = crew(scenario, crew1, "Crew 1");
    c.receiveObjective(lineObjective(crew1, nodePoint(J1), { x: 400, y: 1400 }));
    const log = runControllers(inc, [c], 2_000);
    const accepted = log.decisions.find((d) => d.event.reasonCode === "objective_accepted");
    expect(accepted?.event.actualAction).toMatch(/cutting line from the south end toward the north end/);
    expect(c.status(inc.projectAgent(crew1)).objective).toMatch(/^cut line from the south end toward the north end/);
  });

  it("plans the longest shift: all the work in reach of the crew's end", () => {
    const scenario = farFireScenario();
    const inc = new Incident({ scenario, seed: "line-longest", overrides: calm });
    const c = crew(scenario, crew1, "Crew 1");
    const start = nodePoint(J1);
    const end = nodePoint(HJ);
    const planned = firelineTarget(new RoadIndex(scenario.map), start, end);
    if (!planned.ok) throw new Error("the end is next to a road");
    c.receiveObjective(lineObjective(crew1, start, end));
    const log = runControllers(inc, [c], 2_000);
    const accepted = log.decisions.find((d) => d.event.reasonCode === "objective_accepted");
    const longest = planned.target.workOptionsMs.at(-1)! / 1000;
    expect(accepted?.event.actualAction).toContain(`(work ${longest} s)`);
  });

  it("takes one shift per order, then holds no objective and starts no second shift", () => {
    const scenario = farFireScenario();
    const inc = new Incident({ scenario, seed: "line-one-shift", overrides: calm });
    const c = crew(scenario, crew1, "Crew 1");
    c.receiveObjective(lineObjective(crew1, nodePoint(J1), nodePoint(HJ)));
    const log = runControllers(inc, [c], 600_000);
    expect(c.status(inc.projectAgent(crew1)).objective).toBeNull();
    const starts = log.decisions.filter((d) => d.event.type === "mission_start" && /cutting line/.test(d.event.actualAction));
    expect(starts).toHaveLength(1);
  });

  it("refuses a line whose end is far from every road, without raw ids or reason codes", () => {
    const scenario = farFireScenario();
    const inc = new Incident({ scenario, seed: "line-no-road", overrides: calm });
    const c = crew(scenario, crew1, "Crew 1");
    c.receiveObjective(lineObjective(crew1, { x: 1500, y: 1500 }, { x: 1500, y: 1200 }));
    const log = runControllers(inc, [c], 2_000);
    const rejected = log.decisions.find((d) => d.event.type === "objective_rejected");
    expect(rejected?.event.reasonCode).toBe("no_road_near_line_end");
    expect(c.status(inc.projectAgent(crew1)).objective).toBeNull();
    expect(inc.projectCoordinator().firelines ?? []).toHaveLength(0);
  });

  it("judges the crew's own end: the same line is refused from the far end only", () => {
    const near: MapPoint = nodePoint(J1);
    const far: MapPoint = { x: 1500, y: 1500 };
    const scenario = farFireScenario();
    const run = (start: MapPoint, end: MapPoint): string | undefined => {
      const inc = new Incident({ scenario, seed: "line-own-end", overrides: calm });
      const c = crew(scenario, crew1, "Crew 1");
      c.receiveObjective(lineObjective(crew1, start, end));
      const log = runControllers(inc, [c], 2_000);
      return log.decisions.find((d) => d.event.type === "objective_rejected")?.event.reasonCode;
    };
    expect(run(near, far)).toBeUndefined();
    expect(run(far, near)).toBe("no_road_near_line_end");
  });

  it("lets two crews work one line from opposite ends, each saying its own end", () => {
    const scenario = farFireScenario(["crew-1", "crew-2"]);
    const inc = new Incident({ scenario, seed: "line-two-crews", overrides: calm });
    const c1 = crew(scenario, crew1, "Crew 1");
    const c2 = crew(scenario, crew2, "Crew 2");
    const west = nodePoint(J1);
    const east = nodePoint(HJ);
    c1.receiveObjective(lineObjective(crew1, west, east, "obj-c1"));
    c2.receiveObjective(lineObjective(crew2, east, west, "obj-c2"));
    const log = runControllers(inc, [c1, c2], 2_000);
    const accepted = log.decisions.filter((d) => d.event.reasonCode === "objective_accepted").map((d) => d.event.actualAction);
    expect(accepted).toHaveLength(2);
    expect(accepted.some((a) => /from the west end toward East Junction/.test(a))).toBe(true);
    expect(accepted.some((a) => /from the east end toward West Junction/.test(a))).toBe(true);
  });
});
