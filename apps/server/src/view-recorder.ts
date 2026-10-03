import type { CoordinatorView } from "@ember/domain";

/** Coordinator snapshots actually published to clients during a live run. */
export class ViewRecorder {
  private readonly log: CoordinatorView[] = [];

  record(view: CoordinatorView): void {
    const last = this.log[this.log.length - 1];
    if (last !== undefined && last.sequence === view.sequence) return;
    this.log.push(view);
  }

  coordinatorLog(): readonly CoordinatorView[] {
    return this.log;
  }
}
