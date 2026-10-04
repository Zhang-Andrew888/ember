import { earliestIgnitionMs, type ForecastEnsemble } from "@ember/forecast";

/** Cells the retained forecast treats as already ignited at `nowMs` (planning hint, not ground truth). */
export function forecastBurningCells(ensemble: ForecastEnsemble, nowMs: number): readonly number[] {
  const earliest = earliestIgnitionMs(ensemble);
  const out: number[] = [];
  for (let i = 0; i < earliest.length; i++) {
    if (earliest[i]! <= nowMs) out.push(i);
  }
  return out;
}

export function mergeBurnCellLists(a: readonly number[], b: readonly number[]): readonly number[] {
  if (a.length === 0) return b;
  if (b.length === 0) return a;
  return [...new Set([...a, ...b])];
}
