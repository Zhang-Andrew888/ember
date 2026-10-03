import { SimTimeMs, type AgentId } from "@ember/domain";
import { hashValue, type AgentKnowledgeSnapshot } from "@ember/knowledge";
import { FireField, streamRng, type PublicMap } from "@ember/simulation/model";
import { DEFAULT_FORECAST_CONFIG, widenRanges, type ForecastConfig } from "./config.js";
import { FitAccumulator, fitMember, type FitObservation } from "./fit.js";
import {
  boundaryCandidates,
  buildMember,
  capSupportedMembers,
  noShiftCandidates,
  perturb,
  priorCandidates,
  sampledCandidates,
  type Candidate,
} from "./members.js";
import { rolloutContext, type RolloutContext } from "./rollout.js";
import type { ForecastEnsemble, ForecastEvent, ForecastMember, ParameterRanges } from "./types.js";

/** Hash of exactly what a decision-maker has received, independent of arrival order. */
export function snapshotScopeHash(snapshot: AgentKnowledgeSnapshot): string {
  const ids = snapshot.observations.map((o) => `${o.id}@${o.receivedAt}`).sort();
  return hashValue({ agent: snapshot.agentId, obs: ids });
}

/**
 * One decision-maker's forecast. It only ever sees that decision-maker's knowledge snapshot
 * and the public map: no world seed, no remote fire, no other agent's history.
 */
export class ForecastService {
  readonly events: ForecastEvent[] = [];
  private ensemble: ForecastEnsemble | null = null;
  private version = 0;
  private readonly ctx: RolloutContext;
  private contradictedHash: string | null = null;
  private lastRebuildHash: string | null = null;
  private readonly accum = new FitAccumulator();
  /** How many fit observations each member has already been verified against. */
  private readonly verified = new WeakMap<ForecastMember, { generation: number; upTo: number }>();

  constructor(
    readonly agentId: AgentId,
    map: PublicMap,
    private readonly config: ForecastConfig = DEFAULT_FORECAST_CONFIG,
  ) {
    this.ctx = rolloutContext(map);
  }

  get current(): ForecastEnsemble | null {
    return this.ensemble;
  }

  /** True when a contradiction left no supported member and no rebuild ran for this evidence. */
  needsRebuild(snapshot: AgentKnowledgeSnapshot): boolean {
    return (
      this.ensemble?.reliability === "unreliable" && this.lastRebuildHash !== snapshotScopeHash(snapshot)
    );
  }

  /**
   * Synchronously filter cached predictions against new evidence. If every member fails,
   * the forecast becomes unreliable and a contradiction event explains why. Callers then
   * run rebuild() (asynchronously in a real runtime; the incident never waits for it).
   */
  update(snapshot: AgentKnowledgeSnapshot, nowMs: number): ForecastEnsemble {
    const hash = snapshotScopeHash(snapshot);
    const cur = this.ensemble;
    if (cur !== null && cur.inputHash === hash && nowMs - cur.builtAtMs < this.config.refreshMs) return cur;
    if (cur !== null && cur.inputHash === hash && cur.reliability === "unreliable") return cur;

    const horizonEndMs = nowMs + this.config.horizonMs;
    const fitObs = this.accum.update(snapshot);
    const prefix = this.agentId;
    const pool: readonly (Candidate | ForecastMember)[] =
      cur !== null && cur.reliability === "reliable" && cur.members.every((m) => m.rolloutEndMs >= horizonEndMs)
        ? cur.members
        : cur !== null && cur.reliability === "reliable"
          ? cur.members.map((m) => ({ id: m.id, kind: m.kind, params: m.params }))
          : priorCandidates(this.config, streamRng(`${prefix}`, "forecast-prior"), "p");

    const survivors = this.supported(pool, fitObs, horizonEndMs);
    if (survivors.members.length === 0) {
      const failed = survivors.firstFailure;
      this.ensemble = this.unreliable(snapshot, hash, nowMs, horizonEndMs, widenRanges(this.config, 8));
      if (this.contradictedHash !== hash) {
        this.contradictedHash = hash;
        this.events.push({
          kind: "contradiction",
          agentId: this.agentId,
          atMs: nowMs,
          observationIds: fitObs.map((o) => o.id),
          explanation:
            `Every retained forecast member disagrees with the evidence` +
            (failed === null ? "" : ` (first failed at observation ${failed})`) +
            `; forecast reliability is UNRELIABLE and a broader rebuild is needed.`,
        });
      }
      return this.ensemble;
    }

    const kept = capSupportedMembers(survivors.members, this.config.memberCount, this.config.maxMembers);
    const members = this.replenish(kept, fitObs, horizonEndMs, hash);
    this.ensemble = {
      version: ++this.version,
      inputHash: hash,
      knowledgeRevision: snapshot.revision,
      members,
      provisional: [],
      reliability: "reliable",
      builtAtMs: SimTimeMs.parse(nowMs),
      horizonEndMs,
      widenFactor: cur?.reliability === "reliable" ? cur.widenFactor : 1,
      ranges: cur?.reliability === "reliable" ? cur.ranges : this.config.prior,
      sourceSnapshot: snapshot,
    };
    return this.ensemble;
  }

  /**
   * Broader recovery after contradiction: widen spread-rate, wind and shift-time bounds by
   * factors 2, 4 and 8 around the prior, generate candidates from public conditions plus this
   * decision-maker's own observations, and require enough distinct supported candidates.
   */
  rebuild(snapshot: AgentKnowledgeSnapshot, nowMs: number): ForecastEnsemble {
    const hash = snapshotScopeHash(snapshot);
    this.lastRebuildHash = hash;
    const horizonEndMs = nowMs + this.config.horizonMs;
    const fitObs = this.accum.update(snapshot);
    const observationIds = fitObs.map((o) => o.id);
    let lastRanges = widenRanges(this.config, 8);
    for (const factor of this.config.widenFactors) {
      const ranges = widenRanges(this.config, factor);
      lastRanges = ranges;
      const rng = streamRng(`${hash}`, `forecast-rebuild-${factor}`);
      const candidates: Candidate[] = [
        ...boundaryCandidates(ranges, `r${factor}`),
        ...noShiftCandidates(ranges, `r${factor}`),
        ...sampledCandidates(ranges, rng, this.config.rebuildCandidates, `r${factor}`, "rebuilt"),
      ];
      const supported = this.supported(candidates, fitObs, horizonEndMs).members;
      if (supported.length >= this.config.minSupportedForRecovery) {
        const kept = capSupportedMembers(supported, this.config.memberCount, this.config.maxMembers);
        const members = this.replenish(kept, fitObs, horizonEndMs, `${hash}:${factor}`);
        this.ensemble = {
          version: ++this.version,
          inputHash: hash,
          knowledgeRevision: snapshot.revision,
          members,
          provisional: [],
          reliability: "reliable",
          builtAtMs: SimTimeMs.parse(nowMs),
          horizonEndMs,
          widenFactor: factor,
          ranges,
          sourceSnapshot: snapshot,
        };
        this.events.push({
          kind: "rebuild_complete",
          agentId: this.agentId,
          atMs: nowMs,
          widenFactor: factor,
          ranges,
          observationIds,
          supportedCount: supported.length,
          explanation: `Forecast rebuilt with ranges widened ${factor}x; ${supported.length} supported candidates, reliability restored.`,
        });
        return this.ensemble;
      }
    }
    this.ensemble = this.unreliable(snapshot, hash, nowMs, horizonEndMs, lastRanges);
    this.events.push({
      kind: "rebuild_failed",
      agentId: this.agentId,
      atMs: nowMs,
      ranges: lastRanges,
      observationIds,
      explanation: `No widening round up to 8x produced ${this.config.minSupportedForRecovery} supported candidates; forecast stays UNRELIABLE.`,
    });
    return this.ensemble;
  }

  private unreliable(
    snapshot: AgentKnowledgeSnapshot,
    hash: string,
    nowMs: number,
    horizonEndMs: number,
    ranges: ParameterRanges,
  ): ForecastEnsemble {
    const provisional = boundaryCandidates(ranges, "prov").map((c) =>
      buildMember(this.ctx, this.config, c.id, c.kind, c.params, horizonEndMs),
    );
    return {
      version: ++this.version,
      inputHash: hash,
      knowledgeRevision: snapshot.revision,
      members: [],
      provisional,
      reliability: "unreliable",
      builtAtMs: SimTimeMs.parse(nowMs),
      horizonEndMs,
      widenFactor: this.config.widenFactors[this.config.widenFactors.length - 1] ?? 8,
      ranges,
      sourceSnapshot: snapshot,
    };
  }

  private supported(
    candidates: readonly (Candidate | ForecastMember)[],
    fitObs: readonly FitObservation[],
    horizonEndMs: number,
  ): { members: ForecastMember[]; firstFailure: string | null } {
    const members: ForecastMember[] = [];
    let firstFailure: string | null = null;
    for (const c of candidates) {
      let member: ForecastMember;
      if ("ignitionMs" in c) {
        member = c;
      } else {
        // Screen incrementally in time order, stopping at the first observation it cannot explain;
        // only supported candidates pay for the full horizon.
        const screen = this.screen(c, fitObs);
        if (!screen.pass) {
          if (firstFailure === null) firstFailure = screen.failedObservationId;
          continue;
        }
        member = buildMember(this.ctx, this.config, c.id, c.kind, c.params, horizonEndMs);
        this.verified.set(member, { generation: this.accum.generation, upTo: fitObs.length });
        members.push(member);
        continue;
      }
      const seen = this.verified.get(member);
      const from = seen !== undefined && seen.generation === this.accum.generation ? seen.upTo : 0;
      const fit = fitMember(member, fitObs, this.config.disagreementTolerance, from);
      if (fit.pass) {
        this.verified.set(member, { generation: this.accum.generation, upTo: fitObs.length });
        members.push(member);
      } else if (firstFailure === null) firstFailure = fit.failedObservationId;
    }
    return { members, firstFailure };
  }

  /**
   * Roll a candidate forward only as far as each observation needs, checking observations in time
   * order and stopping at the first it cannot explain. Equivalent to fitting a full rollout.
   */
  private screen(c: Candidate, fitObs: readonly FitObservation[]): { pass: boolean; failedObservationId: string | null } {
    const step = this.config.rolloutStepMs;
    const field = new FireField(this.ctx.terrain, this.ctx.nonburnable);
    field.ignite(this.ctx.initialCells, 0, c.params.initialProgress ?? 0);
    const ordered = [...fitObs].sort((a, b) => a.timeMs - b.timeMs);
    let t = 0;
    let i = 0;
    while (i < ordered.length) {
      const time = ordered[i]!.timeMs;
      const group: FitObservation[] = [];
      while (i < ordered.length && ordered[i]!.timeMs === time) group.push(ordered[i++]!);
      // Include the step after `time`: its cells are recorded as igniting at the start of that step.
      while (t < time + step) {
        t += step;
        field.step(t, step, c.params);
      }
      // Same convention as full rollouts: ignition is recorded at the start of its step.
      const ign = new Float64Array(field.ignitedAtMs.length);
      for (let k = 0; k < ign.length; k++) {
        const v = field.ignitedAtMs[k]!;
        ign[k] = v === 0 || !Number.isFinite(v) ? v : Math.max(0, v - step);
      }
      const partial = { id: c.id, kind: c.kind, params: c.params, ignitionMs: ign, rolloutEndMs: t };
      const fit = fitMember(partial, group, this.config.disagreementTolerance);
      if (!fit.pass) return fit;
    }
    return { pass: true, failedObservationId: null };
  }

  /** Seeded perturbations of supported members, kept only if they are themselves supported. */
  private replenish(
    supported: ForecastMember[],
    fitObs: readonly FitObservation[],
    horizonEndMs: number,
    seed: string,
  ): ForecastMember[] {
    const members = [...supported];
    const target = Math.min(this.config.memberCount, this.config.maxMembers);
    if (members.length >= target || members.length === 0) return members;
    const rng = streamRng(seed, "forecast-replenish");
    const bounds = this.config.physicalBounds;
    let attempts = 0;
    const maxAttempts = (target - members.length) * 8;
    while (members.length < target && attempts < maxAttempts) {
      const base = supported[attempts % supported.length]!;
      const cand = perturb(base.params, rng, bounds, `${base.id}~${attempts}`);
      attempts += 1;
      if (!this.screen(cand, fitObs).pass) continue;
      const member = buildMember(this.ctx, this.config, cand.id, cand.kind, cand.params, horizonEndMs);
      this.verified.set(member, { generation: this.accum.generation, upTo: fitObs.length });
      members.push(member);
    }
    return members;
  }
}

/** Cells ever directly observed burning or burned in this snapshot: closed for good. */
export function directlyObservedClosed(snapshot: AgentKnowledgeSnapshot): Set<number> {
  const closed = new Set<number>();
  for (const obs of snapshot.observations) {
    for (const f of obs.observedFields) {
      if (f.kind === "cell" && f.burnState !== "unburned") closed.add(f.gridCellIndex);
    }
  }
  return closed;
}
