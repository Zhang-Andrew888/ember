import { readFileSync } from "node:fs";
import type { Plugin } from "vite";
import { stripPrivateFields } from "./src/map/stripPrivate.js";

/**
 * Handles `scenarios/*.json?strip` imports (see src/map/activeScenario.ts).
 * Site `requiredWork` is a truth value the coordinator projection never
 * carries (CLAUDE.md simulation rules), so it is removed here, before the
 * data can be bundled; the browser never needs it.
 */
export function scenarioFilesPlugin(): Plugin {
  return {
    name: "ember-scenario-files",
    enforce: "pre",
    load(id) {
      const [path, query] = id.split("?");
      if (query !== "strip" || !path || !path.endsWith(".json")) return null;
      this.addWatchFile(path);
      try {
        // Return JSON text: Vite's own JSON plugin turns `.json?...` ids into a module.
        return JSON.stringify(stripPrivateFields(JSON.parse(readFileSync(path, "utf8"))));
      } catch {
        return "null"; // unparseable JSON: reported by the loader as invalid
      }
    },
  };
}
