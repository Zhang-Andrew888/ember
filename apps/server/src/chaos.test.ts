import { describe, expect, it, vi } from "vitest";
import { AgentId } from "@ember/domain";
import { Rng, cellIndexOf } from "@ember/simulation/model";
import { DEFAULT_FORECAST_CONFIG } from "@ember/forecast";
import { buildSyntheticScenario, recordOf, replayRecord } from "@ember/simulation";
import { ConversationBridge } from "./conversation.js";
import { IncidentSession } from "./session.js";

vi.setConfig({ testTimeout: 600_000 });

const UTTERANCES = [
  "Crew 1, protect the lodge",
  "Crew 2, protect Ridge Cabins",
  "Crew 3 protect Waterworks",
  "Scout, check the north road",
  "Scout check the south junction",
  "Crew 1 return to refuge",
  "Crew 2, hold position",
  "Crew 2, resume your own judgment",
  "Crew 3, what are you doing?",
  "Crew 2, use Scout's latest report",
  "Crew 1, use Scout's latest east corridor report and protect Waterworks",
  "Crew 1 and Crew 2 protect the lodge",
  "protect the harbour",
  "Crew 4, hold",
  "Crew 1, the east road is definitely safe",
  "Crew 1, avoid the east corridor",
  "blah blah",
  "",
];

describe("random coordinator traffic", () => {
  for (const seed of ["ch-1", "ch-2", "ch-3"]) {
    it(`keeps every invariant and replays exactly under random messages and faults (seed ${seed})`, () => {
      const base = buildSyntheticScenario();
      const patch = (x: number, y: number): number[] => [cellIndexOf(x, y)!, cellIndexOf(x + 25, y)!, cellIndexOf(x, y + 25)!, cellIndexOf(x + 25, y + 25)!];
      // Odd seeds: a briefed steady wind and a distant fire keep every agent busy. Even seeds: fire beside the roads.
      const busy = seed !== "ch-2";
      const scenario = { ...base, map: { ...base.map, initialFireCells: busy ? patch(1500, 100) : patch(300, 1000) } };
      const steady = {
        ...DEFAULT_FORECAST_CONFIG,
        prior: { spreadMultiplier: { min: 0.6, max: 0.8 }, windOffsetDeg: { min: -5, max: 5 }, shiftTimeMs: { min: 1_300_000, max: 1_400_000 }, postShiftDeg: { min: 45, max: 100 } },
      };
      const session = new IncidentSession({
        scenario,
        seed,
        overrides: busy ? { spreadMultiplier: 0.6, windShiftMs: 1e9, initialWindRad: 0 } : { windShiftMs: 300_000 },
        controllerConfig: { forecast: busy ? steady : DEFAULT_FORECAST_CONFIG },
      });
      const bridge = new ConversationBridge(session);
      const rng = new Rng(seed.charCodeAt(3) * 104729);
      let wall = 0;
      while (!session.incident.ended && session.incident.simTimeMs < 500_000) {
        session.step();
        bridge.collect();
        wall += 200;
        if (session.incident.simTimeMs % 12_000 === 0) {
          const text = UTTERANCES[rng.int(0, UTTERANCES.length - 1)]!;
          if (text === "") continue;
          const outs = bridge.say(text, wall, `chaos-${session.incident.simTimeMs}`);
          for (const o of outs) {
            expect(o.reply.length).toBeGreaterThan(0);
            // Whatever was said, a rejected or unclear message never produced an action.
            if (o.receipt.status !== "accepted") expect(o.actions.every((a) => a.kind === "set_recipient")).toBe(true);
          }
        }
        if (session.incident.simTimeMs === 100_000) {
          session.incident.submit({ kind: "sensor_fault", agentId: AgentId.parse("crew-1"), untilMs: 160_000 });
        }
        const onCorridor = session.incident.truth().agents.filter((a) => a.state !== "lost" && a.position.kind === "edge" && a.position.edgeId === "e-s-h");
        expect(onCorridor.length).toBeLessThanOrEqual(1);
      }
      bridge.pollWall(wall + 20_000);
      // Messages and objectives never make the simulator reject a structurally invalid plan.
      const bad = session.incident.notices.filter((n) => n.kind === "plan_rejected");
      expect(bad).toEqual([]);
      expect(bridge.transcript.length).toBeGreaterThan(5);
      const replay = replayRecord(recordOf(session.incident));
      expect(replay.hashMatches).toBe(true);
    });
  }
});
