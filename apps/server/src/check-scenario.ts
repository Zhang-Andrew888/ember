import { SimScenario, scenarioGates, validateScenario } from "@ember/simulation";

export interface ScenarioCheck {
  ok: boolean;
  lines: string[];
}

/** Parse scenario JSON text and report schema, structure and geometry-gate results. */
export function checkScenarioText(text: string): ScenarioCheck {
  let raw: unknown;
  try {
    raw = JSON.parse(text) as unknown;
  } catch (e) {
    return { ok: false, lines: [`json: FAIL ${e instanceof Error ? e.message : String(e)}`] };
  }
  const parsed = SimScenario.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, lines: ["schema: FAIL", ...parsed.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`)] };
  }
  const errors = validateScenario(parsed.data);
  const lines = [`structure: ${errors.length === 0 ? "ok" : "FAIL"}`, ...errors.map((e) => `  ${e}`)];
  if (errors.length > 0) return { ok: false, lines };
  let ok = true;
  for (const g of scenarioGates(parsed.data)) {
    lines.push(`${g.ok ? "ok  " : "FAIL"} ${g.gate}: ${g.detail}`);
    if (!g.ok) ok = false;
  }
  return { ok, lines };
}
