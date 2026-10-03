// Check a scenario file against the structural rules and the documented geometry gates.
// Usage: tsx src/check-scenario-cli.ts <scenario.json>   (exit code 1 on any failure)
import { readFileSync } from "node:fs";
import { SimScenario, scenarioGates, validateScenario } from "@ember/simulation";

const path = process.argv[2];
if (path === undefined) {
  process.stdout.write("usage: check-scenario-cli <scenario.json>\n");
  process.exitCode = 2;
} else {
  const parsed = SimScenario.safeParse(JSON.parse(readFileSync(path, "utf8")) as unknown);
  if (!parsed.success) {
    process.stdout.write(`schema: FAIL\n${parsed.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n")}\n`);
    process.exitCode = 1;
  } else {
    const errors = validateScenario(parsed.data);
    process.stdout.write(`structure: ${errors.length === 0 ? "ok" : "FAIL"}\n${errors.map((e) => `  ${e}`).join("\n")}${errors.length > 0 ? "\n" : ""}`);
    let failed = errors.length > 0;
    if (errors.length === 0) {
      for (const g of scenarioGates(parsed.data)) {
        process.stdout.write(`${g.ok ? "ok  " : "FAIL"} ${g.gate}: ${g.detail}\n`);
        if (!g.ok) failed = true;
      }
    }
    process.exitCode = failed ? 1 : 0;
  }
}
