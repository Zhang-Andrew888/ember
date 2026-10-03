import type { CoordinatorView } from "@ember/domain";

/** Coordinator snapshots actually published to clients during a live run. */
export class ViewRecorder {
  private readonly log: CoordinatorView[] = [];

  private lastRevision: number | undefined;

  /**
   * Keeps a view only when `revision` changes. The default is the view's own sequence; the live hub
   * passes the incident's event count instead, because the view sequence now rises every step and
   * recording each one would multiply the replay payload (about 2.3x for a full run).
   */
  record(view: CoordinatorView, revision: number = view.sequence): void {
    if (this.lastRevision === revision) return;
    this.lastRevision = revision;
    this.log.push(view);
  }

  coordinatorLog(): readonly CoordinatorView[] {
    return this.log;
  }
}
