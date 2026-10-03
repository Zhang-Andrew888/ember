import { describe, expect, it } from "vitest";
import { SHOWCASE_SEED } from "./evaluation.js";
import { recordMockPlayback } from "./mock-playback-export.js";

describe("recordMockPlayback", () => {
  it("records monotonic coordinator sequences for a short showcase run", () => {
    const recording = recordMockPlayback({ seed: SHOWCASE_SEED, untilMs: 180_000 });
    expect(recording.views.length).toBeGreaterThan(3);
    const sequences = recording.views.map((v) => v.sequence as number);
    expect(sequences).toEqual([...sequences].sort((a, b) => a - b));
  });

  it(
    "thins a full showcase run to a fixture-sized timeline that ends",
    () => {
      const recording = recordMockPlayback({ seed: SHOWCASE_SEED, untilMs: 1_500_000 });
      expect(recording.views.length).toBeLessThan(200);
      expect(recording.views.length).toBeGreaterThan(5);
      expect(recording.views.at(-1)?.incidentEnd).not.toBeNull();
    },
    120_000,
  );
});
