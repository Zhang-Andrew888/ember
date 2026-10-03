import { AgentId } from "@ember/domain";
import { hashValue } from "@ember/knowledge";
import { CrewController, DispatchController, ScoutController, type ControllerConfig } from "@ember/agents";
import { computeMetrics, percentile, summarize, type MetricsSummary, type RunBundle, type RunMetrics } from "@ember/replay";
import { buildSyntheticScenario, recordOf, type PrivateOverrides, type SimScenario } from "@ember/simulation";
import { POLICY_NAME, POLICY_VERSION, ScriptedCoordinatorPolicy, type RelayLogEntry } from "./policy.js";
import { IncidentSession, type ControllerFactory } from "./session.js";

export type Variant = "dispatch" | "forecast_no_scout" | "ember_line";

export const VARIANTS: readonly Variant[] = ["dispatch", "forecast_no_scout", "ember_line"];

/** Failure injection on seams the product really has: sensors and the coordinator relay path. */
export type Fault =
  | { readonly kind: "sensor_blackout"; readonly agentId: string; readonly fromMs: number; readonly untilMs: number }
  | { readonly kind: "relay_delay"; readonly ms: number }
  | { readonly kind: "relay_drop_every"; readonly n: number };

export interface RunOptions {
  readonly variant: Variant;
  readonly seed: string;
  readonly scenario?: SimScenario;
  readonly overrides?: PrivateOverrides;
  readonly untilMs?: number;
  readonly faults?: readonly Fault[];
  readonly controllerConfig?: Partial<ControllerConfig>;
}

export interface RunResult {
  readonly variant: Variant;
  readonly seed: string;
  readonly metrics: RunMetrics;
  readonly bundle: RunBundle;
  readonly relays: readonly RelayLogEntry[];
  readonly replanLatencyMs: readonly number[];
}

export function factoryFor(variant: Variant): ControllerFactory {
  return (spec, map, config) => {
    const common = { agentId: spec.id, callsign: spec.callsign, map, ...(config === undefined ? {} : { config }) };
    if (spec.role === "scout") return variant === "ember_line" ? new ScoutController({ ...common, role: "scout" }) : null;
    return variant === "dispatch" ? new DispatchController({ ...common, role: "protection_crew" }) : new CrewController({ ...common, role: "protection_crew" });
  };
}

/** Run one variant on one seed under the shared scripted coordinator policy. */
export function runVariant(options: RunOptions): RunResult {
  const scenario = options.scenario ?? buildSyntheticScenario();
  const session = new IncidentSession({
    scenario,
    seed: options.seed,
    ...(options.overrides === undefined ? {} : { overrides: options.overrides }),
    ...(options.controllerConfig === undefined ? {} : { controllerConfig: options.controllerConfig }),
    factory: factoryFor(options.variant),
  });
  const faults = options.faults ?? [];
  const delay = faults.find((f) => f.kind === "relay_delay");
  const drop = faults.find((f) => f.kind === "relay_drop_every");
  const policy = new ScriptedCoordinatorPolicy(session, scenario.map, {
    ...(delay?.kind === "relay_delay" ? { delayMs: delay.ms } : {}),
    ...(drop?.kind === "relay_drop_every" ? { dropEvery: drop.n } : {}),
  });
  const pendingBlackouts = faults.filter((f): f is Extract<Fault, { kind: "sensor_blackout" }> => f.kind === "sensor_blackout");
  const until = options.untilMs ?? 1_500_000;
  while (!session.incident.ended && session.incident.simTimeMs < until) {
    const now = session.incident.simTimeMs;
    for (const b of pendingBlackouts) {
      if (b.fromMs === now) session.incident.submit({ kind: "sensor_fault", agentId: AgentId.parse(b.agentId), untilMs: b.untilMs });
    }
    session.step();
    policy.tick();
  }
  const decisions = session.decisions.map((d) => ({ tick: d.event.tick, agentId: d.event.agentId, type: d.event.type, reasonCode: d.event.reasonCode }));
  const metrics = computeMetrics({ incident: session.incident, decisions, replanLatencyMs: session.replanLatencyMs });
  const bundle: RunBundle = {
    format: "ember-run-bundle-v1",
    record: recordOf(session.incident),
    decisions: session.decisions.map((d) => d.event),
    policy: { name: POLICY_NAME, version: POLICY_VERSION },
    policyLog: policy.log.map((l) => ({ tick: l.tick, observationId: l.observationId, toAgentId: l.toAgentId })),
  };
  return { variant: options.variant, seed: options.seed, metrics, bundle, relays: policy.log, replanLatencyMs: session.replanLatencyMs };
}

/** Seed families: development, one rehearsed showcase seed, and held-out evaluation seeds. */
export const DEV_SEEDS = ["dev-1", "dev-2", "dev-3", "dev-4", "dev-5"] as const;
export const SHOWCASE_SEED = "showcase-1";
export const HELD_OUT_SEEDS: readonly string[] = Array.from({ length: 20 }, (_, i) => `heldout-${String(i + 1).padStart(2, "0")}`);

/**
 * Held-out stress mix: every fourth seed forces an earlier-than-prior wind shift, every fourth
 * (offset by one) a wider spread rate. The rest keep the seeded world parameters unchanged.
 */
export function overridesForSeed(seed: string, index: number): PrivateOverrides {
  if (index % 4 === 0) return { windShiftMs: 280_000 };
  if (index % 4 === 1) return { spreadMultiplier: 1.55 };
  void seed;
  return {};
}

export interface VariantReport {
  readonly variant: Variant;
  readonly summary: MetricsSummary;
  readonly runs: readonly RunMetrics[];
  readonly replanLatencyP50Ms: number;
  readonly replanLatencyP95Ms: number;
}

export interface EvaluationReport {
  readonly format: "ember-evaluation-v1";
  readonly scenarioVersion: string;
  readonly scenarioHash: string;
  readonly policy: { readonly name: string; readonly version: string };
  readonly seeds: readonly string[];
  readonly untilMs: number;
  readonly variants: readonly VariantReport[];
  readonly caveats: readonly string[];
}

const CAVEATS = [
  "Synthetic authored scenario, not the real road extract; constants are documented defaults, not calibrated physics.",
  "All variants share one hidden fire trajectory per seed up to their own end; protection does not alter spread.",
  "Runs may end at different times, so final health is an endpoint measure, not an equal-exposure experiment.",
  "Return counts show interrupted and superseded missions beside completed returns; none are dropped.",
  "A shared scripted coordinator policy relays evidence; it is not a model of human coordination.",
  "Ensemble pass fractions are design counts, not validated survival probabilities.",
];

export function runEvaluation(options: { seeds: readonly string[]; variants?: readonly Variant[]; untilMs?: number; onRun?: (r: RunResult) => void }): EvaluationReport {
  const variants = options.variants ?? VARIANTS;
  const scenario = buildSyntheticScenario();
  const untilMs = options.untilMs ?? 1_500_000;
  const reports: VariantReport[] = [];
  for (const variant of variants) {
    const runs: RunMetrics[] = [];
    const latencies: number[] = [];
    options.seeds.forEach((seed, i) => {
      const result = runVariant({ variant, seed, scenario, overrides: overridesForSeed(seed, i), untilMs });
      runs.push(result.metrics);
      latencies.push(...result.replanLatencyMs);
      options.onRun?.(result);
    });
    reports.push({
      variant,
      summary: summarize(runs),
      runs,
      replanLatencyP50Ms: percentile(latencies, 50),
      replanLatencyP95Ms: percentile(latencies, 95),
    });
  }
  return {
    format: "ember-evaluation-v1",
    scenarioVersion: scenario.version,
    scenarioHash: hashValue(scenario),
    policy: { name: POLICY_NAME, version: POLICY_VERSION },
    seeds: options.seeds,
    untilMs,
    variants: reports,
    caveats: CAVEATS,
  };
}
