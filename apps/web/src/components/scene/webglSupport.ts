export type MapFailure = "unsupported" | "context-lost" | "crashed";

/** Whether this browser can create a WebGL context at all. Assumed true where there is no DOM. */
export function canCreateWebGL(createCanvas: () => HTMLCanvasElement | null = defaultCanvas): boolean {
  const canvas = createCanvas();
  if (canvas === null) return true;
  try {
    return canvas.getContext("webgl2") !== null || canvas.getContext("webgl") !== null;
  } catch {
    return false;
  }
}

function defaultCanvas(): HTMLCanvasElement | null {
  return typeof document === "undefined" ? null : document.createElement("canvas");
}

export const MAP_FAILURE_TEXT: Record<MapFailure, string> = {
  unsupported: "The 3D map cannot start: this browser has no WebGL support, or graphics acceleration is turned off.",
  "context-lost": "The 3D map stopped because the browser lost its graphics context.",
  crashed: "The 3D map stopped because of a rendering error.",
};
