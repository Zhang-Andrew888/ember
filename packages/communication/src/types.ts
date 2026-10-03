import type { AgentId, CommandId, EvidenceReference } from "@ember/domain";

export interface IncomingMessage {
  readonly commandId: CommandId;
  readonly text: string;
  readonly idempotencyKey: string;
  readonly submittedAt: Date;
}

export interface InterpretedCommand {
  readonly commandId: CommandId;
  readonly recipientId: AgentId;
  readonly text: string;
  readonly evidenceRefs: readonly EvidenceReference[];
  readonly requiresClarification: boolean;
  readonly clarificationQuestion: string | null;
}
