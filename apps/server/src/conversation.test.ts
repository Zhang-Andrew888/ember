import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentId, NodeId } from "@ember/domain";
import { DEFAULT_FORECAST_CONFIG } from "@ember/forecast";
import { FailingInterpreter, type IntentEnvelope } from "@ember/communication";
import { buildSyntheticScenario, type SimScenario } from "@ember/simulation";
import { cellIndexOf } from "@ember/simulation/model";
import { ConversationBridge, directoryFor } from "./conversation.js";
import { IncidentSession } from "./session.js";

vi.setConfig({ testTimeout: 180_000 });

// Long synchronous tests starve the worker's RPC channel; yield a macrotask between tests so it can flush.
afterEach(async () => {
  await new Promise<void>((resolve) => setTimeout(() => resolve(), 0));
});

const calm = { spreadMultiplier: 0.6, windShiftMs: 1e9, initialWindRad: 0 };
const patch = (x: number, y: number): number[] => [cellIndexOf(x, y)!, cellIndexOf(x + 25, y)!, cellIndexOf(x, y + 25)!, cellIndexOf(x + 25, y + 25)!];
const steady = {
  ...DEFAULT_FORECAST_CONFIG,
  prior: {
    spreadMultiplier: { min: 0.6, max: 0.8 },
    windOffsetDeg: { min: -5, max: 5 },
    shiftTimeMs: { min: 1_300_000, max: 1_400_000 },
    postShiftDeg: { min: 45, max: 100 },
  },
};

function farScenario(agents?: string[]): SimScenario {
  const base = buildSyntheticScenario(agents === undefined ? {} : { agents });
  return { ...base, map: { ...base.map, initialFireCells: patch(1500, 100) } };
}

describe("conversation over a session (no provider)", () => {
  it("applies a typed objective and speaks the committed result, not a guess", () => {
    const session = new IncidentSession({ scenario: farScenario(["crew-1", "crew-2"]), seed: "conv-1", overrides: calm, controllerConfig: { forecast: steady } });
    const bridge = new ConversationBridge(session);
    const outs = bridge.say("Crew 2, protect the lodge", 0);
    expect(outs[0]?.receipt.status).toBe("accepted");
    expect(bridge.gateway.activeRecipientId).toBe("crew-2");
    // The acknowledgement says only what was sent; no speech exists until a decision is committed.
    expect(bridge.sink.spoken).toHaveLength(0);
    session.runUntil(10_000, () => bridge.collect());
    const decision = session.decisions.find((d) => d.event.agentId === "crew-2" && (d.event.reasonCode === "objective_accepted" || d.event.type === "objective_rejected"));
    expect(decision).toBeDefined();
    const spokenForDecision = bridge.transcript.filter((t) => t.kind === "agent" && t.text.startsWith("Crew 2"));
    expect(spokenForDecision.length).toBeGreaterThan(0);
    // Everything that was voiced is exactly a transcript line that came from a committed decision.
    const agentLines = new Set(bridge.transcript.filter((t) => t.kind === "agent").map((t) => t.text));
    for (const spoken of bridge.sink.spoken) expect(agentLines.has(spoken)).toBe(true);
    expect(session.incident.projectCoordinator().activeRecipientId).toBe("crew-2");
  });

  it("relays only the named crew's report to the addressed crew", () => {
    const base = buildSyntheticScenario({ agents: ["crew-1", "crew-2", "crew-3"], sites: ["site-a"] });
    const scenario: SimScenario = {
      ...base,
      agents: base.agents.map((a) => (a.id === "crew-3" ? { ...a, startNodeId: NodeId.parse("n-j1") } : a)),
      map: { ...base.map, initialFireCells: patch(450, 850) },
    };
    const session = new IncidentSession({
      scenario,
      seed: "conv-2",
      overrides: { spreadMultiplier: 1.3, windShiftMs: 1e9, initialWindRad: 0 },
      uncontrolled: ["crew-3"],
    });
    const bridge = new ConversationBridge(session);
    session.runUntil(100_000, () => bridge.collect());
    const out = bridge.say("Crew 2, use Crew 3's latest report", 0)[0]!;
    expect(out.actions.some((a) => a.kind === "relay")).toBe(true);
    session.runUntil(102_000, () => bridge.collect());
    const store2 = session.incident.agentStores.get(AgentId.parse("crew-2"))!;
    const store1 = session.incident.agentStores.get(AgentId.parse("crew-1"))!;
    const relay = out.actions.find((a) => a.kind === "relay");
    const id = relay?.kind === "relay" ? relay.observationId : "";
    expect(store2.provenanceOf(id)).toBe("relay");
    expect(store1.provenanceOf(id)).toBeUndefined();
  });

  it("keeps agents working when the provider fails, and fails the input visibly after 10 s", () => {
    const session = new IncidentSession({ scenario: farScenario(["crew-1"]), seed: "conv-3", overrides: calm, controllerConfig: { forecast: steady } });
    const bridge = new ConversationBridge(session, { interpreter: new FailingInterpreter() });
    bridge.say("Crew 1, hold", 1000);
    session.runUntil(20_000, () => bridge.collect());
    const failed = bridge.pollWall(11_500);
    expect(failed[0]?.receipt.status).toBe("rejected");
    expect(bridge.transcript.some((t) => /Nothing was applied/.test(t.text))).toBe(true);
    // The crew was never told to hold: it carried on with its own mission.
    expect(session.decisions.some((d) => d.event.type === "mission_start")).toBe(true);
    expect(session.controllers.get(AgentId.parse("crew-1"))?.state).not.toBe("HOLDING");
  });

  it("evaluates a delayed provider answer at the current tick and lets the crew's own checks decide", () => {
    const session = new IncidentSession({ scenario: farScenario(["crew-1"]), seed: "conv-4", overrides: calm, controllerConfig: { forecast: steady } });
    const bridge = new ConversationBridge(session, { interpreter: { interpret: () => null } });
    const ticket = bridge.gateway.submit({ commandId: "c1", text: "Crew 1 protect the lodge", idempotencyKey: "k1", wallMs: 0 });
    session.runUntil(40_000, () => bridge.collect());
    const env: IntentEnvelope = {
      commandId: "c1",
      inputSequence: ticket.inputSequence,
      explicitRecipient: "Crew 1",
      kind: "objective",
      objective: { kind: "protect", targetName: "Community Lodge" },
      evidenceQueries: [],
      unsupportedClaims: [],
    };
    const outcomes = bridge.gateway.deliver(ticket.inputSequence, env);
    expect(outcomes[0]?.evaluatedAtSimMs).toBe(40_000);
    bridge.applyOutcomes(outcomes);
    session.runUntil(45_000, () => bridge.collect());
    const verdict = session.decisions.find((d) => d.event.reasonCode === "objective_accepted" || d.event.type === "objective_rejected");
    expect(verdict).toBeDefined();
    expect(verdict!.event.tick).toBeGreaterThanOrEqual(40_000);
  });

  it("rejects a command during a voice turn when the incident ends and stops stale audio", () => {
    const session = new IncidentSession({ scenario: farScenario(["crew-1"]), seed: "conv-5", overrides: calm, uncontrolled: ["crew-1"] });
    const bridge = new ConversationBridge(session, { interpreter: { interpret: () => null } });
    bridge.gateway.submit({ commandId: "late", text: "Crew 1 hold", idempotencyKey: "kl", wallMs: 0 });
    session.runUntil(1_500_000, () => bridge.collect());
    bridge.collect();
    expect(session.incident.ended).toBe(true);
    const after = bridge.say("Crew 1, hold", 0);
    expect(after[0]?.receipt.status).toBe("incident_ended");
    expect(bridge.transcript.some((t) => t.kind === "system" && /incident has ended/i.test(t.text))).toBe(true);
    expect(bridge.sink.spoken.filter((s) => /incident has ended/i.test(s))).toHaveLength(1);
  });

  it("builds a directory of public names only", () => {
    const dir = directoryFor(farScenario());
    const text = JSON.stringify(dir);
    expect(text).not.toContain("terrainSeed");
    expect(dir.sites.map((s) => s.name)).toContain("Community Lodge");
    expect(dir.locations.some((l) => l.name === "east corridor")).toBe(true);
  });
});
