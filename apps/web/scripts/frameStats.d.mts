export const TARGET_FPS: number;
export const TARGET_FRAME_MS: number;
export const SOFTWARE_LABEL: string;
export interface FrameSummary {
  frames: number;
  meanMs: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  maxMs: number;
  fps: number;
  over33msShare: number;
  meetsTarget: boolean;
}
export function summarizeFrames(intervalsMs: number[]): FrameSummary;
export function isSoftwareRenderer(rendererString: string | null | undefined): boolean;
export function resultLabel(input: { renderer: string | null | undefined; machine?: string | undefined; headless: boolean }): string;
export function parseViewport(text: string): { width: number; height: number };
