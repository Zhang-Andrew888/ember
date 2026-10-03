import type { AgentId, DecisionEvent } from "@ember/domain";
import type { Incident } from "@ember/simulation";
import type { AgentController, ControllerEnvironment, ControllerState } from "./types.js";

export interface RunLog {
  readonly decisions: { tick: number; event: DecisionEvent; text: string }[];
  readonly states: Map<string, { tick: number; state: ControllerState }[]>;
  readonly forecastEvents: { tick: number; agentId: string; kind: string }[];
}

/**
 * Test and harness loop: each simulated second every controller ticks on its own projection,
 * its orders go into the input log, then the world advances one authoritative step.
 */
export function runControllers(
  incident: Incident,
  controllers: readonly AgentController[],
  untilMs: number,
  env: (id: AgentId) => ControllerEnvironment = () => ({}),
  log: RunLog = { decisions: [], states: new Map(), forecastEvents: [] },
): RunLog {
  while (!incident.ended && incident.simTimeMs < untilMs) {
    for (const c of controllers) {
      const out = c.tick(incident.projectAgent(c.agentId), env(c.agentId));
      for (const order of out.orders) incident.submit(order);
      for (const r of out.reports) incident.submit({ kind: "report", agentId: c.agentId, text: r.text, urgent: r.urgent });
      for (const d of out.decisions) log.decisions.push({ tick: d.tick, event: d, text: r0(out, d) });
      for (const f of out.forecastEvents) log.forecastEvents.push({ tick: f.atMs, agentId: f.agentId, kind: f.kind });
      const list = log.states.get(c.agentId) ?? [];
      if (list[list.length - 1]?.state !== out.state) list.push({ tick: incident.simTimeMs, state: out.state });
      log.states.set(c.agentId, list);
    }
    incident.advanceTo(incident.simTimeMs + 1000);
  }
  return log;
}

function r0(_out: unknown, d: DecisionEvent): string {
  return `${d.type}:${d.reasonCode}:${d.actualAction}`;
}
