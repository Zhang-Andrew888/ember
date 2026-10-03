import { CoordinatorView } from "@ember/domain";
import raw from "./recordedMockPlayback.json" with { type: "json" };

/** Offline-recorded showcase run (see apps/server/src/export-mock-playback-cli.ts). */
export function defaultRecordedMockSnapshots(): CoordinatorView[] {
  if (raw.format !== "ember-mock-playback-v1" || !Array.isArray(raw.views)) {
    throw new Error("recordedMockPlayback.json is missing or invalid");
  }
  return raw.views.map((view) => CoordinatorView.parse(view));
}
