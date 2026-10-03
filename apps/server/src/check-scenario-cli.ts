// Check a scenario file against the structural rules and the documented geometry gates.
// Usage: tsx src/check-scenario-cli.ts <scenario.json>   (exit code 1 on any failure)
import { readFileSync } from "node:fs";
import { checkScenarioText } from "./check-scenario.js";

const path = process.argv[2];
if (path === undefined) {
  process.stdout.write("usage: check-scenario-cli <scenario.json>\n");
  process.exitCode = 2;
} else {
  const result = checkScenarioText(readFileSync(path, "utf8"));
  process.stdout.write(`${result.lines.join("\n")}\n`);
  process.exitCode = result.ok ? 0 : 1;
}
