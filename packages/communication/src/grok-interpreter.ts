import type { InterpretationRequest, Interpreter } from "./interpreter.js";
import { IntentEnvelope as IntentSchema, type IntentEnvelope } from "./intent.js";

export type GrokIntentComplete = (request: InterpretationRequest) => Promise<string>;

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
 */
export function createGrokInterpreter(
  complete: GrokIntentComplete,
  onDeliver: (inputSequence: number, envelope: IntentEnvelope) => void,
): Interpreter {
  return {
    interpret(req: InterpretationRequest): IntentEnvelope | null {
      void complete(req)
        .then((raw) => parseModelIntentJson(raw, req))
        .then((env) => {
          onDeliver(req.inputSequence, env ?? clarificationFallback(req, "Could not interpret that command. Please rephrase."));
        })
        .catch(() => {
          onDeliver(
            req.inputSequence,
            clarificationFallback(req, "Interpretation is temporarily unavailable. Please try again or rephrase."),
          );
        });
      return null;
    },
  };
}
