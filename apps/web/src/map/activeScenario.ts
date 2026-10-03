import snapshot from "./synthetic-v1.snapshot.json";
import { loadScenarioMap } from "./loadScenario.js";

/**
 * The only module that touches the filesystem layout. `?strip` is handled
 * by scenarioPlugin.ts (removes requiredWork before bundling).
 */
const repoScenarioFiles = import.meta.glob<unknown>("../../../../scenarios/*.json", {
  eager: true,
  import: "default",
  query: "?strip",
});

const byName: Record<string, unknown> = {};
for (const [path, data] of Object.entries(repoScenarioFiles)) {
  byName[path.slice(path.lastIndexOf("/") + 1)] = data;
}

export const scenarioMap = loadScenarioMap(byName, { name: "synthetic-v1.snapshot.json", data: snapshot });
