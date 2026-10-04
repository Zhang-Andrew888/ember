import { CoordinatorView } from "@ember/domain";
import { buildSyntheticScenario, wallMsForSimTime } from "@ember/simulation";
import { factoryFor, type Variant } from "./evaluation.js";
import { ScriptedCoordinatorPolicy } from "./policy.js";
import { IncidentSession } from "./session.js";

export interface MockPlaybackRecording {
  readonly format: "ember-mock-playback-v1";
  readonly seed: string;
  readonly variant: Variant;
  readonly views: readonly CoordinatorView[];
}

/** Offline coordinator timeline for in-browser mock mode (ember_line + scripted relay). */
export function recordMockPlayback(options: {
  readonly seed: string;
  readonly variant?: Variant;
  readonly untilMs?: number;
}): MockPlaybackRecording {
  const variant = options.variant ?? "ember_line";
  const session = new IncidentSession({
    scenario: buildSyntheticScenario(),
    seed: options.seed,
    factory: factoryFor(variant),
  });
  const policy = new ScriptedCoordinatorPolicy(session, session.incident.scenario.map);
  const views: CoordinatorView[] = [];
  const until = options.untilMs ?? 1_500_000;

  while (!session.incident.ended && session.incident.simTimeMs < until) {
    session.step();
    policy.tick();
    session.incident.setWallElapsed(wallMsForSimTime(session.incident.simTimeMs));
    const view = session.coordinatorView();
    const last = views[views.length - 1];
    if (last === undefined || last.sequence !== view.sequence) {
      views.push(view);
    }
  }
  session.incident.setWallElapsed(wallMsForSimTime(session.incident.simTimeMs));
  const finalView = session.coordinatorView();
  const last = views[views.length - 1];
  if (last === undefined || last.sequence !== finalView.sequence) {
    views.push(finalView);
  }

  for (const view of views) {
    CoordinatorView.parse(view);
  }

  return {
    format: "ember-mock-playback-v1",
    seed: options.seed,
    variant,
    views: thinPlaybackViews(views),
  };
}

/** Keep the timeline playable without multi-megabyte mock fixtures (~30 s sim between frames). */
export function thinPlaybackViews(views: readonly CoordinatorView[], everySimMs = 30_000): CoordinatorView[] {
  if (views.length === 0) return [];
  const out: CoordinatorView[] = [views[0]!];
  let nextKeep = (views[0]!.simTimeMs as number) + everySimMs;
  for (const view of views.slice(1)) {
    const t = view.simTimeMs as number;
    const keep =
      t >= nextKeep ||
      view.incidentEnd !== null ||
      (view.recentReports.some((r) => r.urgent) && t >= nextKeep);
    if (keep) {
      out.push(view);
      nextKeep = t + everySimMs;
    }
  }
  const last = views[views.length - 1]!;
  if (out[out.length - 1]!.sequence !== last.sequence) {
    out.push(last);
  }
  return out;
}
