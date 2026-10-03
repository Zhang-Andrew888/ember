// Authoritative step benchmark (docs/VALIDATION.md: p95 under 20 ms; AGENTS.md: never reach 200 ms).
//   pnpm --filter @ember/simulation build && node packages/simulation/scripts/benchmark.mjs
// Prints step wall-time percentiles per spread setting plus the machine and scenario hash, since the
// docs ask for performance numbers to name the machine they were measured on.
import os from "node:os";
import { AgentId, NodeId, SiteId } from "@ember/domain";
import { Incident, SIM_DEFAULTS, authoredCommit, buildSyntheticScenario, scenarioHash } from "../dist/index.js";
import { RoadIndex } from "../dist/model/index.js";

const scenario = buildSyntheticScenario();
const road = new RoadIndex(scenario.map);
const pct = (sorted, q) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))];

function steps(seed, overrides) {
  const inc = new Incident({ scenario, seed, overrides });
  for (const a of scenario.agents.filter((x) => x.role === "protection_crew")) {
    const west = a.startNodeId === "n-rw";
    inc.submit(
      authoredCommit({
        road,
        agentId: AgentId.parse(a.id),
        planId: `bench-${a.id}`,
        knowledgeRevision: inc.agentRevision(AgentId.parse(a.id)),
        startNode: NodeId.parse(a.startNodeId),
        departMs: 0,
        approach: west ? ["e-rw-j1", "e-j1-s", "e-s-h", "e-h-sa"] : ["e-rs-sc"],
        workSiteId: SiteId.parse(west ? "site-a" : "site-c"),
        workMs: 200_000,
        back: [],
      }),
    );
  }
  const times = [];
  while (!inc.ended && inc.simTimeMs < SIM_DEFAULTS.incidentHorizonMs) {
    const t0 = performance.now();
    inc.advanceTo(inc.simTimeMs + SIM_DEFAULTS.stepMs);
    times.push(performance.now() - t0);
  }
  return times;
}

console.log(`node ${process.version} | ${os.cpus()[0]?.model} x${os.cpus().length} | ${os.platform()} ${os.release()}`);
console.log(`scenario ${scenarioHash(scenario).slice(0, 16)} | grid ${SIM_DEFAULTS.gridSize}x${SIM_DEFAULTS.gridSize}\n`);
let worst = 0;
for (const [label, overrides] of [
  ["slow spread (0.6x, late shift)", { spreadMultiplier: 0.6, windShiftMs: 650_000, initialWindRad: 0 }],
  ["ordinary (1.0x)", { spreadMultiplier: 1, windShiftMs: 450_000, initialWindRad: 0 }],
  ["fast spread (1.6x, early shift)", { spreadMultiplier: 1.6, windShiftMs: 250_000, initialWindRad: 0 }],
]) {
  steps("warmup", overrides); // let the JIT settle before measuring
  const sorted = steps("bench", overrides).sort((a, b) => a - b);
  worst = Math.max(worst, sorted.at(-1));
  console.log(
    `${label.padEnd(34)} n=${sorted.length}  median ${pct(sorted, 0.5).toFixed(3)}  p95 ${pct(sorted, 0.95).toFixed(3)}  p99 ${pct(sorted, 0.99).toFixed(3)}  max ${sorted.at(-1).toFixed(2)} ms`,
  );
}
console.log(`\nworst step ${worst.toFixed(2)} ms vs 200 ms hard limit; p95 target 20 ms`);
