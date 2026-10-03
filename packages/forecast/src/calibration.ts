/** Offline calibration inputs: each truth arrival comes from a seed withheld from model tuning. */
export interface ArrivalCalibrationCase {
  readonly earliestMs: number | null;
  readonly latestMs: number | null;
  readonly truthMs: number;
}

/** Smallest symmetric padding covering the requested fraction of calibration arrivals. */
export function calibrateArrivalPadding(cases: readonly ArrivalCalibrationCase[], coverage = 0.9): number {
  if (cases.length === 0 || !(coverage > 0 && coverage <= 1)) throw new RangeError("Calibration needs cases and coverage in (0, 1]");
  const residuals = cases.map(({ earliestMs, latestMs, truthMs }) => {
    if (earliestMs === null) return Infinity;
    return Math.max(0, earliestMs - truthMs, latestMs === null ? 0 : truthMs - latestMs);
  }).sort((a, b) => a - b);
  const padding = residuals[Math.ceil(coverage * residuals.length) - 1]!;
  if (!Number.isFinite(padding)) throw new RangeError("Ensemble misses too many arrivals for finite band calibration");
  return padding;
}

export function arrivalCoverage(cases: readonly ArrivalCalibrationCase[], paddingMs: number): number {
  if (cases.length === 0) return NaN;
  const covered = cases.filter(({ earliestMs, latestMs, truthMs }) =>
    earliestMs !== null && earliestMs - paddingMs <= truthMs && (latestMs === null || truthMs <= latestMs + paddingMs),
  ).length;
  return covered / cases.length;
}
