/** Pixels from the bottom within which the reader still counts as "following" the transcript. */
export const STICK_THRESHOLD_PX = 48;

export interface ScrollMetrics {
  readonly scrollTop: number;
  readonly clientHeight: number;
  readonly scrollHeight: number;
}

/** True when the reader is at (or near) the bottom, so new lines should keep scrolling into view. */
export function isNearBottom(metrics: ScrollMetrics, thresholdPx = STICK_THRESHOLD_PX): boolean {
  return metrics.scrollHeight - metrics.scrollTop - metrics.clientHeight <= thresholdPx;
}
