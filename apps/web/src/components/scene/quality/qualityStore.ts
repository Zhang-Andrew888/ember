import { useSyncExternalStore } from "react";
import type { QualityTier } from "./tiers.js";

/**
 * Small external store shared by the render pipeline (inside the Canvas) and
 * the dev-only debug panel (plain DOM). Production code only ever reads the
 * defaults; nothing outside the debug panel writes `params` or `mode`.
 */
export interface SceneParams {
  readonly background: string;
  readonly fog: string;
  readonly fogNear: number;
  readonly fogFar: number;
  readonly skyFill: string;
  readonly groundFill: string;
  readonly key: string;
  readonly keyPosition: readonly [number, number, number];
  readonly keyIntensity: number;
  readonly fillIntensity: number;
  readonly bloomStrength: number;
  readonly bloomRadius: number;
  /** Linear-HDR luminance above which pixels bloom; > 1 so only emissive fire glows. */
  readonly bloomThreshold: number;
  readonly vignetteStrength: number;
}

export const DEFAULT_PARAMS: SceneParams = {
  background: "#111a22",
  fog: "#18242e",
  fogNear: 650,
  fogFar: 1900,
  skyFill: "#8aa6d0",
  groundFill: "#2b2a22",
  key: "#ffbf80",
  keyPosition: [-420, 300, 260],
  keyIntensity: 1.0,
  fillIntensity: 1.3,
  bloomStrength: 0.55,
  bloomRadius: 0.45,
  bloomThreshold: 1.0,
  vignetteStrength: 0.28,
};

export type QualityMode = "auto" | QualityTier;

export interface QualityState {
  readonly mode: QualityMode;
  readonly autoTier: QualityTier;
  readonly params: SceneParams;
}

let state: QualityState = { mode: "auto", autoTier: "high", params: DEFAULT_PARAMS };
const listeners = new Set<() => void>();

function set(next: QualityState): void {
  state = next;
  for (const listener of listeners) listener();
}

export const qualityStore = {
  getState: (): QualityState => state,
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  setMode: (mode: QualityMode) => set({ ...state, mode }),
  setAutoTier: (autoTier: QualityTier) => {
    if (autoTier === state.autoTier) return;
    set({ ...state, autoTier });
  },
  setParams: (patch: Partial<SceneParams>) => set({ ...state, params: { ...state.params, ...patch } }),
  resetParams: () => set({ ...state, params: DEFAULT_PARAMS }),
};

export function currentTier(s: QualityState): QualityTier {
  return s.mode === "auto" ? s.autoTier : s.mode;
}

export function useQualityState(): QualityState {
  return useSyncExternalStore(qualityStore.subscribe, qualityStore.getState);
}

/**
 * Recent render cost for the dev debug panel. Kept OUT of the main store on
 * purpose: it changes every few frames, and anything subscribed to the main
 * store (the whole Canvas tree) would re-render with it. Only the dev panel
 * subscribes, and only dev builds write it.
 */
let frameMs = 0;
const frameListeners = new Set<() => void>();

export const frameMsStore = {
  get: (): number => frameMs,
  set(value: number): void {
    if (Math.abs(value - frameMs) < 0.5) return;
    frameMs = value;
    for (const listener of frameListeners) listener();
  },
  subscribe(listener: () => void): () => void {
    frameListeners.add(listener);
    return () => frameListeners.delete(listener);
  },
};

export function useFrameMs(): number {
  return useSyncExternalStore(frameMsStore.subscribe, frameMsStore.get);
}
