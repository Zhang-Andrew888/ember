import { describe, it, expect, vi, afterEach } from "vitest";
import {
  CommandGateway,
  INTERPRETATION_DEADLINE_MS,
  createGrokInterpreter,
  type IntentEnvelope,
  type InterpretationRequest,
} from "@ember/communication";
import { completeIntentInterpretation } from "./chat.js";

const sampleReq: InterpretationRequest = {
  commandId: "cmd-1",
  inputSequence: 0,
  text: "Crew 1, hold position",
  activeRecipientCallsign: null,
  directory: {
    agents: [{ id: "crew-1", callsign: "Crew 1", role: "protection_crew" }],
    sites: [],
    locations: [],
    corridors: [],
  },
};

describe("xai/chat", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("POSTs chat completions and returns assistant content", async () => {
    vi.stubEnv("XAI_API_KEY", "test-key");
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: '{"kind":"objective","objective":{"kind":"hold"}}' } }],
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const out = await completeIntentInterpretation(sampleReq, fetchMock as unknown as typeof fetch);
    expect(out).toContain("hold");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.x.ai/v1/chat/completions",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ Authorization: "Bearer test-key" }),
      }),
    );
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as { model: string; messages: unknown[] };
    expect(body.messages).toHaveLength(2);
    expect(body.model).toBeTruthy();
  });

  it("throws when the API key is missing", async () => {
    vi.stubEnv("XAI_API_KEY", "");
    await expect(completeIntentInterpretation(sampleReq)).rejects.toThrow(/XAI_API_KEY/);
  });

  it("aborts a never-resolving fetch when interpretation times out and ignores a late delivery", async () => {
    vi.stubEnv("XAI_API_KEY", "test-key");
    const timeout = vi.spyOn(AbortSignal, "timeout");
    let signal: AbortSignal | undefined;
    const fetchMock = vi.fn((_url: string, init?: { signal?: AbortSignal }) => {
      signal = init?.signal;
      return new Promise((_resolve, reject) => {
        signal?.addEventListener("abort", () => {
          reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
        });
      });
    });

    const hook: { deliver?: (seq: number, env: IntentEnvelope) => void } = {};
    const gw = new CommandGateway({
      directory: sampleReq.directory,
      interpreter: createGrokInterpreter(
        (req, sig) => completeIntentInterpretation(req, fetchMock as unknown as typeof fetch, sig),
        (seq, env) => hook.deliver?.(seq, env),
      ),
      picture: () => [],
      status: () => null,
      nowSimMs: () => 0,
      incidentEnded: () => false,
    });
    const applied: IntentEnvelope[] = [];
    hook.deliver = (seq, env) => {
      applied.push(env);
      gw.deliver(seq, env);
    };

    const ticket = gw.submit({ commandId: "cmd-1", text: "Crew 1, hold position", idempotencyKey: "k1", wallMs: 0 });
    expect(ticket.outcomes).toHaveLength(0);
    expect(timeout).toHaveBeenCalledWith(INTERPRETATION_DEADLINE_MS);
    expect(signal?.aborted).toBe(false);

    const failed = gw.poll(INTERPRETATION_DEADLINE_MS);
    expect(failed[0]?.receipt.status).toBe("rejected");
    expect(failed[0]?.actions).toHaveLength(0);
    expect(signal?.aborted).toBe(true);
    await Promise.resolve();
    await Promise.resolve();
    expect(applied).toHaveLength(0);

    const late = gw.deliver(ticket.inputSequence, {
      commandId: "cmd-1",
      inputSequence: ticket.inputSequence,
      kind: "objective",
      explicitRecipient: "Crew 1",
      objective: { kind: "hold" },
      evidenceQueries: [],
      unsupportedClaims: [],
    });
    expect(late).toHaveLength(0);
  });

  it("aborts a never-resolving fetch when the incident ends and ignores a late delivery", async () => {
    vi.stubEnv("XAI_API_KEY", "test-key");
    let signal: AbortSignal | undefined;
    const fetchMock = vi.fn((_url: string, init?: { signal?: AbortSignal }) => {
      signal = init?.signal;
      return new Promise(() => {});
    });
    const gw = new CommandGateway({
      directory: sampleReq.directory,
      interpreter: createGrokInterpreter(
        (req, sig) => completeIntentInterpretation(req, fetchMock as unknown as typeof fetch, sig),
        () => {},
      ),
      picture: () => [],
      status: () => null,
      nowSimMs: () => 0,
      incidentEnded: () => false,
    });
    const ticket = gw.submit({ commandId: "cmd-1", text: "Crew 1, hold position", idempotencyKey: "k-end", wallMs: 0 });
    const cancelled = gw.endIncident();
    expect(cancelled[0]?.receipt.status).toBe("incident_ended");
    expect(cancelled[0]?.actions).toHaveLength(0);
    expect(signal?.aborted).toBe(true);
    const late = gw.deliver(ticket.inputSequence, {
      commandId: "cmd-1",
      inputSequence: ticket.inputSequence,
      kind: "objective",
      explicitRecipient: "Crew 1",
      objective: { kind: "hold" },
      evidenceQueries: [],
      unsupportedClaims: [],
    });
    expect(late).toHaveLength(0);
  });
});
