import { z } from "zod";
import type { CoordinatorView} from "@ember/domain";
import { DecisionEvent, type DomainEvent } from "@ember/domain";
import { Incident, RunRecord, SIM_DEFAULTS } from "@ember/simulation";
import type { ReplayReader } from "./types.js";

/** Everything needed to play a run back later: inputs for the world, plus recorded decisions. */
export const RunBundle = z.object({
  format: z.literal("ember-run-bundle-v1"),
  record: RunRecord,
  decisions: z.array(DecisionEvent),
  policy: z.object({ name: z.string(), version: z.string() }).nullable(),
  /** Every relay the scripted coordinator policy made, so a comparison is auditable. */
  policyLog: z.array(z.object({ tick: z.number().int(), observationId: z.string(), toAgentId: z.string() })),
});
export type RunBundle = z.infer<typeof RunBundle>;

/**
 * Plays a bundle back from recorded data: world events by re-running the record's inputs (no
 * agent logic, no provider), decisions from the recording, merged in time order.
 */
export class BundleReplayReader implements ReplayReader {
  constructor(private readonly bundle: RunBundle) {}

  private run(): { events: DomainEvent[]; incident: Incident } {
    const rec = RunRecord.parse(this.bundle.record);
    const incident = new Incident({ scenario: rec.scenario, seed: rec.seed, overrides: rec.overrides });
    const byTime = new Map<number, RunRecord["inputs"]>();
    for (const a of rec.inputs) byTime.set(a.appliedAtMs, [...(byTime.get(a.appliedAtMs) ?? []), a]);
    const events: { at: number; seq: number; event: DomainEvent }[] = [];
    let seq = 0;
    for (const d of this.bundle.decisions) events.push({ at: d.tick, seq: seq++, event: { kind: "decision", payload: d } });
    while (!incident.ended && incident.simTimeMs < rec.finalTimeMs) {
      const next = incident.simTimeMs + SIM_DEFAULTS.stepMs;
      for (const a of (byTime.get(next) ?? []).sort((x, y) => x.ordinal - y.ordinal)) incident.submit(a.input);
      for (const e of incident.advanceTo(next)) {
        const at = e.kind === "observation" ? e.payload.observedAt : e.kind === "incident_end" ? e.payload.tick : next;
        events.push({ at, seq: seq++, event: e });
      }
    }
    events.sort((a, b) => a.at - b.at || a.seq - b.seq);
    return { events: events.map((e) => e.event), incident };
  }

  async *readEvents(): AsyncIterable<DomainEvent> {
    for (const e of this.run().events) yield e;
  }

  async buildFinalView(): Promise<CoordinatorView> {
    return this.run().incident.projectCoordinator();
  }
}

export function serializeBundle(bundle: RunBundle): string {
  return JSON.stringify(RunBundle.parse(bundle));
}

export function parseBundle(text: string): RunBundle {
  return RunBundle.parse(JSON.parse(text) as unknown);
}
