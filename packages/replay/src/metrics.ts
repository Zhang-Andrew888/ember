import type { Incident } from "@ember/simulation";

export interface DecisionLike {
  readonly tick: number;
  readonly agentId: string;
  readonly type: string;
  readonly reasonCode: string;
}

export interface SiteMetrics {
  readonly id: string;
  readonly requiredWork: number;
  /** Protection work delivered, capped per task. */
  readonly completedWork: number;
  readonly damage: number;
  readonly destroyed: boolean;
  /** Fully protected at some point (work complete), whether or not it was destroyed later. */
  readonly protectionComplete: boolean;
}

export interface RunMetrics {
  readonly seed: string;
  readonly scenarioVersion: string;
  readonly sites: readonly SiteMetrics[];
  readonly protectionWorkDelivered: number;
  readonly sitesProtectedAndStanding: number;
  readonly sitesDestroyed: number;
  readonly sitesCompletedThenDestroyed: number;
  readonly crewsLiving: number;
  readonly crewsLost: number;
  readonly scoutLost: boolean;
  /** Raw mission counts. Interrupted and superseded are shown beside returns, never removed. */
  readonly missionsStarted: number;
  readonly returnsCompleted: number;
  readonly lostBeforeReturn: number;
  readonly supersededMissions: number;
  readonly interruptedByIncidentEnd: number;
  readonly returnPlanFailures: number;
  readonly strandedSeconds: number;
  readonly withdrawals: number;
  readonly retreats: number;
  readonly refusals: number;
  readonly relays: number;
  readonly endingReasons: readonly string[];
  readonly displayReason: string | null;
  readonly simSeconds: number;
  readonly wallElapsedMs: number;
  /** Real wall milliseconds spent on each planning pass, when measured by the caller. */
  readonly replanLatencyMs: readonly number[];
}

export interface MetricsInput {
  readonly incident: Incident;
  readonly decisions: readonly DecisionLike[];
  readonly replanLatencyMs?: readonly number[];
}

/** Derive outcome metrics from the truth log, notices and committed decisions of one run. */
export function computeMetrics(input: MetricsInput): RunMetrics {
  const { incident, decisions } = input;
  const truth = incident.truth();
  const endTick = incident.end?.tick ?? incident.simTimeMs;
  const sites: SiteMetrics[] = truth.sites.map((s) => {
    const required = incident.scenario.map.sites.find((x) => x.id === s.id)?.requiredWork ?? 0;
    return {
      id: s.id,
      requiredWork: required,
      completedWork: Math.min(required, s.completedWork),
      damage: s.damage,
      destroyed: s.destroyed,
      protectionComplete: s.completedWork >= required,
    };
  });
  const roleOf = (id: string): string => incident.scenario.agents.find((a) => a.id === id)?.role ?? "";
  const accepted = new Map<string, { agentId: string; mode: string; hasWork: boolean; legCount: number }>();
  let started = 0;
  let returned = 0;
  let lostBefore = 0;
  let superseded = 0;
  let interrupted = 0;
  for (const n of incident.notices) {
    if (n.kind === "plan_accepted") {
      accepted.set(n.planId, { agentId: n.agentId, mode: n.mode, hasWork: n.hasWork, legCount: n.legCount });
      if (n.hasWork && n.mode === "normal" && roleOf(n.agentId) === "protection_crew") started += 1;
    } else if (n.kind === "plan_complete") {
      // Every plan ends at a refuge, so a completed plan with legs is a completed return, whether
      // it was a mission's own return, a withdrawal, a retreat or a plain return order.
      const a = accepted.get(n.planId);
      if (a !== undefined && a.legCount > 0 && roleOf(a.agentId) === "protection_crew") returned += 1;
    } else if (n.kind === "plan_cancelled") {
      const a = accepted.get(n.planId);
      if (a === undefined || roleOf(a.agentId) !== "protection_crew") continue;
      if (n.reason === "superseded" && a.hasWork) superseded += 1;
      if (n.reason === "agent_lost" && a.legCount > 0) lostBefore += 1;
    } else if (n.kind === "plan_interrupted_by_end") {
      const a = accepted.get(n.planId);
      if (a !== undefined && a.legCount > 0 && roleOf(a.agentId) === "protection_crew") interrupted += 1;
    }
  }
  let stranded = 0;
  const byAgent = new Map<string, DecisionLike[]>();
  for (const d of decisions) byAgent.set(d.agentId, [...(byAgent.get(d.agentId) ?? []), d]);
  for (const list of byAgent.values()) {
    list.sort((a, b) => a.tick - b.tick);
    list.forEach((d, i) => {
      if (d.type !== "stranded_reported") return;
      const next = list.slice(i + 1).find((x) => x.type !== "idle");
      const lost = incident.notices.find((n) => n.kind === "agent_lost" && n.agentId === d.agentId);
      const until = Math.min(next?.tick ?? endTick, lost?.tick ?? endTick, endTick);
      stranded += Math.max(0, until - d.tick) / 1000;
    });
  }
  const count = (type: string): number => decisions.filter((d) => d.type === type).length;
  const agents = truth.agents;
  return {
    seed: incident.seed,
    scenarioVersion: incident.scenario.version,
    sites,
    protectionWorkDelivered: sites.reduce((a, s) => a + s.completedWork, 0),
    sitesProtectedAndStanding: sites.filter((s) => s.protectionComplete && !s.destroyed).length,
    sitesDestroyed: sites.filter((s) => s.destroyed).length,
    sitesCompletedThenDestroyed: sites.filter((s) => s.protectionComplete && s.destroyed).length,
    crewsLiving: agents.filter((a) => roleOf(a.id) === "protection_crew" && a.state !== "lost").length,
    crewsLost: agents.filter((a) => roleOf(a.id) === "protection_crew" && a.state === "lost").length,
    scoutLost: agents.some((a) => roleOf(a.id) === "scout" && a.state === "lost"),
    missionsStarted: started,
    returnsCompleted: returned,
    lostBeforeReturn: lostBefore,
    supersededMissions: superseded,
    interruptedByIncidentEnd: interrupted,
    returnPlanFailures: count("retreat_triggered") + count("stranded_reported"),
    strandedSeconds: stranded,
    withdrawals: count("withdrawal_triggered"),
    retreats: count("retreat_triggered"),
    refusals: count("objective_rejected"),
    relays: incident.inputLog.filter((i) => i.input.kind === "relay").length,
    endingReasons: incident.end?.matchingReasons ?? [],
    displayReason: incident.end?.displayReason ?? null,
    simSeconds: endTick / 1000,
    wallElapsedMs: incident.wallElapsedMs,
    replanLatencyMs: input.replanLatencyMs ?? [],
  };
}

export interface MetricsSummary {
  readonly runs: number;
  readonly meanWorkDelivered: number;
  readonly meanSitesProtectedAndStanding: number;
  readonly meanSitesDestroyed: number;
  readonly meanCrewsLost: number;
  readonly totalMissionsStarted: number;
  readonly totalReturnsCompleted: number;
  readonly totalInterrupted: number;
  readonly totalSuperseded: number;
  readonly totalLostBeforeReturn: number;
  readonly meanSimSeconds: number;
  readonly endingCounts: Readonly<Record<string, number>>;
}

const mean = (xs: readonly number[]): number => (xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length);

export function summarize(runs: readonly RunMetrics[]): MetricsSummary {
  const endings: Record<string, number> = {};
  for (const r of runs) if (r.displayReason !== null) endings[r.displayReason] = (endings[r.displayReason] ?? 0) + 1;
  return {
    runs: runs.length,
    meanWorkDelivered: mean(runs.map((r) => r.protectionWorkDelivered)),
    meanSitesProtectedAndStanding: mean(runs.map((r) => r.sitesProtectedAndStanding)),
    meanSitesDestroyed: mean(runs.map((r) => r.sitesDestroyed)),
    meanCrewsLost: mean(runs.map((r) => r.crewsLost)),
    totalMissionsStarted: runs.reduce((a, r) => a + r.missionsStarted, 0),
    totalReturnsCompleted: runs.reduce((a, r) => a + r.returnsCompleted, 0),
    totalInterrupted: runs.reduce((a, r) => a + r.interruptedByIncidentEnd, 0),
    totalSuperseded: runs.reduce((a, r) => a + r.supersededMissions, 0),
    totalLostBeforeReturn: runs.reduce((a, r) => a + r.lostBeforeReturn, 0),
    meanSimSeconds: mean(runs.map((r) => r.simSeconds)),
    endingCounts: endings,
  };
}

/** Percentile of a numeric list (nearest rank). */
export function percentile(xs: readonly number[], p: number): number {
  if (xs.length === 0) return 0;
  const sorted = [...xs].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))]!;
}
