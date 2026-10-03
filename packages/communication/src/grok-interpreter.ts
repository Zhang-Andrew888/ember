import { INTERPRETATION_DEADLINE_MS } from "./gateway.js";
import type { InterpretationRequest, Interpreter } from "./interpreter.js";
import { IntentEnvelope as IntentSchema, type IntentEnvelope } from "./intent.js";

export type GrokIntentComplete = (request: InterpretationRequest, signal: AbortSignal) => Promise<string>;

/** Strip optional markdown fences and parse model JSON into a validated envelope. */
export function parseModelIntentJson(raw: string, req: InterpretationRequest): IntentEnvelope | null {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)```$/i);
  const body = (fenced?.[1] ?? trimmed).trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(body) as unknown;
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const merged = {
    ...(parsed as Record<string, unknown>),
    commandId: req.commandId,
    inputSequence: req.inputSequence,
  };
  const result = IntentSchema.safeParse(merged);
  return result.success ? result.data : null;
}

export function clarificationFallback(req: InterpretationRequest, message: string): IntentEnvelope {
  return IntentSchema.parse({
    commandId: req.commandId,
    inputSequence: req.inputSequence,
    kind: "objective",
    evidenceQueries: [],
    unsupportedClaims: [],
    clarification: message,
  });
}

/**
 * Async Grok (or any LLM) adapter: `interpret` returns null immediately; the model answer is
 * delivered through `onDeliver`, which should call `CommandGateway.deliver`.
 * The provider signal aborts when the interpretation deadline elapses, the gateway fails the
 * command, or the incident ends. Aborted calls are not delivered.
 */
export function createGrokInterpreter(
  complete: GrokIntentComplete,
  onDeliver: (inputSequence: number, envelope: IntentEnvelope) => void,
): Interpreter {
  const inflight = new Map<number, AbortController>();

  const drop = (sequence: number): void => {
    const controller = inflight.get(sequence);
    if (controller === undefined) return;
    inflight.delete(sequence);
    controller.abort();
  };

  return {
    interpret(req: InterpretationRequest): IntentEnvelope | null {
      const controller = new AbortController();
      const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(INTERPRETATION_DEADLINE_MS)]);
      inflight.set(req.inputSequence, controller);
      void complete(req, signal)
        .then((raw) => {
          if (signal.aborted) return;
          onDeliver(
            req.inputSequence,
            parseModelIntentJson(raw, req) ?? clarificationFallback(req, "Could not interpret that command. Please rephrase."),
          );
        })
        .catch(() => {
          if (signal.aborted) return;
          onDeliver(
            req.inputSequence,
            clarificationFallback(req, "Interpretation is temporarily unavailable. Please try again or rephrase."),
          );
        })
        .finally(() => {
          inflight.delete(req.inputSequence);
        });
      return null;
    },
    cancel(sequence: number): void {
      drop(sequence);
    },
    cancelAll(): void {
      for (const sequence of [...inflight.keys()]) drop(sequence);
    },
  };
}
