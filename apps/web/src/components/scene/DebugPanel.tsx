import { currentTier, qualityStore, useQualityState, type QualityMode, type SceneParams } from "./quality/qualityStore.js";
import { QUALITY_TIERS } from "./quality/tiers.js";

/**
 * DEV-ONLY scene tuning panel (tier override, colours, light position, fog,
 * bloom, vignette). It is imported only through `import.meta.env.DEV ? lazy(...)`
 * in SceneView.tsx, so a production build contains none of it; the
 * debugPanelGuard test enforces that import shape.
 */
export default function DebugPanel() {
  const state = useQualityState();
  const { params } = state;
  const num = (key: keyof SceneParams, min: number, max: number, step: number) => (
    <label className="debug-panel__row">
      {key}
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={params[key] as number}
        onChange={(e) => qualityStore.setParams({ [key]: Number(e.target.value) })}
      />
      <output>{(params[key] as number).toFixed(2)}</output>
    </label>
  );
  const color = (key: keyof SceneParams) => (
    <label className="debug-panel__row">
      {key}
      <input type="color" value={params[key] as string} onChange={(e) => qualityStore.setParams({ [key]: e.target.value })} />
    </label>
  );
  const key = params.keyPosition;
  const setKey = (index: 0 | 1 | 2, value: number) => {
    const next: [number, number, number] = [key[0], key[1], key[2]];
    next[index] = value;
    qualityStore.setParams({ keyPosition: next });
  };

  return (
    <details className="debug-panel">
      <summary>Scene debug (dev only)</summary>
      <label className="debug-panel__row">
        quality
        <select value={state.mode} onChange={(e) => qualityStore.setMode(e.target.value as QualityMode)}>
          <option value="auto">auto</option>
          {QUALITY_TIERS.map((tier) => (
            <option key={tier} value={tier}>
              {tier}
            </option>
          ))}
        </select>
        <output>
          {currentTier(state)} · {state.frameMs.toFixed(1)} ms
        </output>
      </label>
      {color("background")}
      {color("fog")}
      {num("fogNear", 100, 2000, 10)}
      {num("fogFar", 500, 4000, 10)}
      {color("skyFill")}
      {color("groundFill")}
      {color("key")}
      {num("keyIntensity", 0, 3, 0.05)}
      {num("fillIntensity", 0, 3, 0.05)}
      {(["x", "y", "z"] as const).map((axis, i) => (
        <label key={axis} className="debug-panel__row">
          key {axis}
          <input type="range" min={-800} max={800} step={10} value={key[i as 0 | 1 | 2]} onChange={(e) => setKey(i as 0 | 1 | 2, Number(e.target.value))} />
          <output>{key[i as 0 | 1 | 2]}</output>
        </label>
      ))}
      {num("bloomStrength", 0, 2, 0.05)}
      {num("bloomRadius", 0, 1, 0.05)}
      {num("bloomThreshold", 0.5, 3, 0.05)}
      {num("vignetteStrength", 0, 1, 0.02)}
      <button type="button" onClick={() => qualityStore.resetParams()}>
        Reset tweaks
      </button>
    </details>
  );
}
