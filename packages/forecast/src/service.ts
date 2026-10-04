import { SimTimeMs, type AgentId } from "@ember/domain";
import { hashValue, type AgentKnowledgeSnapshot } from "@ember/knowledge";
import { FireField, streamRng, type PublicMap } from "@ember/simulation/model";
import { DEFAULT_FORECAST_CONFIG, physicalRanges, widenRanges, type ForecastConfig } from "./config.js";
import { FitAccumulator, fitIgnition, fitMember, type FitObservation } from "./fit.js";
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
import { rolloutContext, type RolloutContext, type WarmRollout } from "./rollout.js";
import { forecastStep } from "./dynamics.js";
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
  private readonly versions: ForecastEnsemble[] = [];
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

  get history(): readonly ForecastEnsemble[] { return [...this.versions]; }

  getVersion(version: number): ForecastEnsemble | null { return this.versions[version - 1] ?? null; }

  private publish(ensemble: ForecastEnsemble): ForecastEnsemble {
    this.ensemble = ensemble;
    this.versions.push(ensemble);
    return ensemble;
  }

  private assimilate(members: readonly ForecastMember[], fitObs: readonly FitObservation[]): ForecastMember[] {
    // A small positive floor keeps every supported hazard in the ensemble regardless of weight.
    const scores = members.map((member) => Math.max(0.01, Math.exp(-10 * fitMember(member, fitObs, this.config.disagreementTolerance).disagreement)));
    const total = scores.reduce((sum, score) => sum + score, 0);
    return members.map((member, i) => ({
      ...member,
      weight: scores[i]! / total,
      ...(member.kind === "replenished" ? { parentMemberId: member.id.slice(0, member.id.lastIndexOf("~")) } : {}),
    }));
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
      const unreliable = this.publish(this.unreliable(snapshot, hash, nowMs, horizonEndMs, widenRanges(this.config, 8)));
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
      return unreliable;
    }

    const kept = capSupportedMembers(survivors.members, this.config.memberCount, this.config.maxMembers);
    const members = this.replenish(kept, fitObs, horizonEndMs, hash);
    return this.publish({
      version: ++this.version,
      parentVersion: cur?.version ?? null,
      inputHash: hash,
      knowledgeRevision: snapshot.revision,
      members: this.assimilate(members, fitObs),
      provisional: [],
      reliability: "reliable",
      builtAtMs: SimTimeMs.parse(nowMs),
      horizonEndMs,
      arrivalPaddingMs: this.config.arrivalPaddingMs,
      widenFactor: cur?.reliability === "reliable" ? cur.widenFactor : 1,
      ranges: cur?.reliability === "reliable" ? cur.ranges : this.config.prior,
      sourceSnapshot: snapshot,
      observationIds: fitObs.map((o) => o.id),
    });
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
        const rebuilt = this.publish({
          version: ++this.version,
          parentVersion: this.ensemble?.version ?? null,
          inputHash: hash,
          knowledgeRevision: snapshot.revision,
          members: this.assimilate(members, fitObs),
          provisional: [],
          reliability: "reliable",
          builtAtMs: SimTimeMs.parse(nowMs),
          horizonEndMs,
          arrivalPaddingMs: this.config.arrivalPaddingMs,
          widenFactor: factor,
          ranges,
          sourceSnapshot: snapshot,
          observationIds,
        });
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
        return rebuilt;
      }
    }
    const failed = this.publish(this.unreliable(snapshot, hash, nowMs, horizonEndMs, lastRanges));
    this.events.push({
      kind: "rebuild_failed",
      agentId: this.agentId,
      atMs: nowMs,
      ranges: lastRanges,
      observationIds,
      explanation: `No widening round up to 8x produced ${this.config.minSupportedForRecovery} supported candidates; forecast stays UNRELIABLE.`,
    });
    return failed;
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
      parentVersion: this.ensemble?.version ?? null,
      inputHash: hash,
      knowledgeRevision: snapshot.revision,
      members: [],
      provisional,
      reliability: "unreliable",
      builtAtMs: SimTimeMs.parse(nowMs),
      horizonEndMs,
      arrivalPaddingMs: this.config.arrivalPaddingMs,
      widenFactor: this.config.widenFactors[this.config.widenFactors.length - 1] ?? 8,
      ranges,
      sourceSnapshot: snapshot,
      observationIds: snapshot.observations.map((o) => o.id),
    };
  }

  private supported(
    candidates: readonly (Candidate | ForecastMember)[],
    fitObs: readonly FitObservation[],
    horizonEndMs: number,
  ): { members: ForecastMember[]; firstFailure: string | null } {
    const members: ForecastMember[] = [];
    let firstFailure: string | null = null;
    let groups: FitObservation[][] | null = null;
    for (const c of candidates) {
      let member: ForecastMember;
      if ("ignitionMs" in c) {
        member = c;
      } else {
        // Screen incrementally in time order, stopping at the first observation it cannot explain;
        // only supported candidates pay for the full horizon.
        groups ??= groupByTime(fitObs);
        const screen = this.screen(c, groups);
        if (!screen.pass) {
          if (firstFailure === null) firstFailure = screen.failedObservationId;
          continue;
        }
        member = buildMember(this.ctx, this.config, c.id, c.kind, c.params, horizonEndMs, screen.warm);
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
   * order and stopping at the first it cannot explain. Equivalent to fitting a full rollout. A
   * passing candidate hands back its field so the full rollout can carry on from there.
   */
  private screen(
    c: Candidate,
    groups: readonly (readonly FitObservation[])[],
  ): { pass: boolean; failedObservationId: string | null; warm?: WarmRollout } {
    const step = this.config.rolloutStepMs;
    const field = new FireField(this.ctx.terrain, this.ctx.nonburnable, this.ctx.cleared);
    field.ignite(this.ctx.initialCells, 0, c.params.initialProgress ?? 0);
    let t = 0;
    for (const group of groups) {
      const time = group[0]!.timeMs;
      // Include the step after `time`: its cells are recorded as igniting at the start of that step.
      while (t < time + step) {
        t += step;
        forecastStep(field, t, step, c.params);
      }
      // Same convention as full rollouts: ignition is recorded at the start of its step.
      const fit = fitIgnition(field.ignitedAtMs, step, group, this.config.disagreementTolerance);
      if (!fit.pass) return fit;
    }
    return { pass: true, failedObservationId: null, warm: { field, atMs: t, stepMs: step } };
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
    const bounds = physicalRanges(this.config);
    let attempts = 0;
    const groups = groupByTime(fitObs);
    const maxAttempts = (target - members.length) * 8;
    while (members.length < target && attempts < maxAttempts) {
      const base = supported[attempts % supported.length]!;
      const cand = perturb(base.params, rng, bounds, `${base.id}~${attempts}`);
      attempts += 1;
      const screened = this.screen(cand, groups);
      if (!screened.pass) continue;
      const member = buildMember(this.ctx, this.config, cand.id, cand.kind, cand.params, horizonEndMs, screened.warm);
      this.verified.set(member, { generation: this.accum.generation, upTo: fitObs.length });
      members.push(member);
    }
    return members;
  }
}

/** Observations in time order, those at the same time together (stable among equals). */
function groupByTime(fitObs: readonly FitObservation[]): FitObservation[][] {
  const ordered = [...fitObs].sort((a, b) => a.timeMs - b.timeMs);
  const groups: FitObservation[][] = [];
  for (const o of ordered) {
    const last = groups[groups.length - 1];
    if (last !== undefined && last[0]!.timeMs === o.timeMs) last.push(o);
    else groups.push([o]);
  }
  return groups;
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
