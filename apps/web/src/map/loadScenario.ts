import { ScenarioFile } from "./scenarioSchema.js";
import { buildScenarioMap, type ScenarioMap } from "./scenarioMap.js";

/**
 * Picks the scenario the scene renders. The first file in `candidates`
 * (sorted by name) that passes ScenarioFile validation wins; invalid files
 * (for example the all-"PENDING" placeholder) are skipped and reported.
 * If none validates, the local snapshot is used. Throws only if the
 * snapshot itself is invalid, which is a build error.
 */
export function loadScenarioMap(
  candidates: Readonly<Record<string, unknown>>,
  snapshot: { readonly name: string; readonly data: unknown },
): ScenarioMap {
  const skipped: Array<{ name: string; reason: string }> = [];
  for (const name of Object.keys(candidates).sort()) {
    const parsed = ScenarioFile.safeParse(candidates[name]);
    if (parsed.success) {
      return buildScenarioMap(parsed.data, { kind: "scenarios-dir", name, skipped });
    }
    const first = parsed.error.issues[0];
    skipped.push({ name, reason: first ? `${first.path.join(".") || "(root)"}: ${first.message}` : "invalid" });
  }
  const fallback = ScenarioFile.parse(snapshot.data);
  return buildScenarioMap(fallback, { kind: "local-snapshot", name: snapshot.name, skipped });
}
