import { CanvasTexture, RepeatWrapping, SRGBColorSpace } from "three";

/**
 * Small canvas-drawn pattern textures (no asset files). Patterns carry
 * meaning that colour alone must not: hatch = forecast, chevrons = travel
 * direction, dashes = returning, dots = stale.
 */
function makeTexture(size: [number, number], draw: (ctx: CanvasRenderingContext2D) => void): CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = size[0];
  canvas.height = size[1];
  const ctx = canvas.getContext("2d");
  if (ctx) draw(ctx);
  const texture = new CanvasTexture(canvas);
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

/** Diagonal hatching, translucent between lines (forecast uses colors.forecastEnvelope). */
export function createHatchTexture(color: string, lineAlpha = 0.95, fillAlpha = 0.16): CanvasTexture {
  return makeTexture([64, 64], (ctx) => {
    ctx.fillStyle = color;
    ctx.globalAlpha = fillAlpha;
    ctx.fillRect(0, 0, 64, 64);
    ctx.globalAlpha = lineAlpha;
    ctx.strokeStyle = color;
    ctx.lineWidth = 8;
    for (const offset of [-64, 0, 64]) {
      ctx.beginPath();
      ctx.moveTo(offset, 64);
      ctx.lineTo(offset + 64, 0);
      ctx.stroke();
    }
  });
}

/** Repeating ">" chevrons pointing toward increasing u (direction of travel). */
export function createChevronTexture(color: string): CanvasTexture {
  return makeTexture([64, 32], (ctx) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = 7;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(18, 5);
    ctx.lineTo(44, 16);
    ctx.lineTo(18, 27);
    ctx.stroke();
  });
}

/** Solid band with transparent gaps along u (returning). */
export function createDashTexture(color: string): CanvasTexture {
  return makeTexture([64, 8], (ctx) => {
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, 36, 8);
  });
}

/** Solid line (working). */
export function createSolidTexture(color: string): CanvasTexture {
  return makeTexture([8, 8], (ctx) => {
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, 8, 8);
  });
}

/** Opaque ground with crossed diagonal lines (firebreak: cleared ground). Distinct from the one-way forecast hatch. */
export function createCrosshatchTexture(ground: string, line: string): CanvasTexture {
  return makeTexture([32, 32], (ctx) => {
    ctx.fillStyle = ground;
    ctx.fillRect(0, 0, 32, 32);
    ctx.strokeStyle = line;
    ctx.lineWidth = 3;
    for (const offset of [-32, 0, 32]) {
      ctx.beginPath();
      ctx.moveTo(offset, 32);
      ctx.lineTo(offset + 32, 0);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(offset, 0);
      ctx.lineTo(offset + 32, 32);
      ctx.stroke();
    }
  });
}
