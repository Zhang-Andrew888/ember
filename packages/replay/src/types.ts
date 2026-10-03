import type { CoordinatorView, DomainEvent } from "@ember/domain";

export interface ReplayReader {
  readEvents(): AsyncIterable<DomainEvent>;
  buildFinalView(): Promise<CoordinatorView>;
}
