// Writes apps/web/src/net/recordedMockPlayback.json for in-browser mock demo playback.
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { SHOWCASE_SEED } from "./evaluation.js";
import { recordMockPlayback } from "./mock-playback-export.js";

const seed = process.argv[2] ?? SHOWCASE_SEED;
const out =
  process.argv[3] ??
  join(dirname(fileURLToPath(import.meta.url)), "../../web/src/net/recordedMockPlayback.json");

const recording = recordMockPlayback({ seed });
writeFileSync(out, JSON.stringify(recording));
process.stdout.write(`wrote ${out} (${recording.views.length} views, end=${recording.views.at(-1)?.incidentEnd?.displayReason ?? "active"})\n`);
