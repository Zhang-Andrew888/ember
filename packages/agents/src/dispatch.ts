import { SimTimeMs } from "@ember/domain";
import type { ForecastEnsemble } from "@ember/forecast";
import type { AgentProjection } from "@ember/simulation";
import { SIM_DEFAULTS } from "@ember/simulation/model";
import { CrewController } from "./controller.js";

/**
 * Evaluation baseline, not an allowed control policy in released user mode: "current-conditions
 * dispatch". It picks the shortest route to useful work and keeps common local hazard detection
 * and emergency response, but admits missions with no forecast: every road is clear unless it
 * has been directly observed burning or burned.
 */
export class DispatchController extends CrewController {
  protected override refreshForecast(proj: AgentProjection, now: number): ForecastEnsemble {
    const n = SIM_DEFAULTS.gridSize * SIM_DEFAULTS.gridSize;
    return {
      inputHash: `dispatch-${proj.knowledgeRevision}`,
      knowledgeRevision: proj.knowledgeRevision,
      members: [
        {
          id: "no-forecast",
          kind: "sampled",
          params: { spreadMultiplier: 1, initialWindRad: 0, windShiftMs: 1e9, postShiftWindRad: 0 },
          ignitionMs: new Float64Array(n).fill(Infinity),
          rolloutEndMs: now + 3_600_000,
        },
      ],
      provisional: [],
      reliability: "reliable",
      builtAtMs: SimTimeMs.parse(now),
      horizonEndMs: now + 1_800_000,
      widenFactor: 1,
      ranges: this.currentEnsemble?.ranges ?? {
        spreadMultiplier: { min: 1, max: 1 },
        windOffsetDeg: { min: 0, max: 0 },
        shiftTimeMs: { min: 1e9, max: 1e9 },
        postShiftDeg: { min: 0, max: 0 },
      },
      sourceSnapshot: proj.knowledge,
    };
  }
}
