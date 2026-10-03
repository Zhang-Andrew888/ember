// packages/communication - owns: recipient resolution, evidence references, command validation, audio priority
// Must not: override feasibility checks
export * from "./intent.js";
export * from "./interpreter.js";
export {
  clarificationFallback,
  createGrokInterpreter,
  parseModelIntentJson,
  type GrokIntentComplete,
} from "./grok-interpreter.js";
export {
  CommandGateway,
  INTERPRETATION_DEADLINE_MS,
  statusReply,
  type AgentStatus,
  type GatewayAction,
  type GatewayEnv,
  type GatewayNotice,
  type GatewayOutcome,
  type IncomingMessage,
  type Report,
  type Ticket,
} from "./gateway.js";
export * from "./speech.js";
export * from "./capture.js";
export * from "./replies.js";
