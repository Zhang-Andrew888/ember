import { SIM_DEFAULTS, windDirectionAt, type FireField } from "@ember/simulation/model";
import type { ForecastParams } from "./types.js";

/** Advance one forecast step, including moisture and a possible ember jump. */
export function forecastStep(field: FireField, toMs: number, dtMs: number, params: ForecastParams): void {
  const moisture = params.moistureMultiplier ?? 1;
  field.step(toMs, dtMs, { ...params, spreadMultiplier: params.spreadMultiplier / moisture });
  const distance = Math.round(params.spotDistanceCells ?? 0);
  const spotAt = params.spotTimeMs ?? Infinity;
  if (distance <= 0 || !(toMs - dtMs < spotAt && spotAt <= toMs)) return;
  const wind = windDirectionAt(params, spotAt);
  const dx = Math.round(Math.cos(wind) * distance);
  const dy = Math.round(Math.sin(wind) * distance);
  const size = SIM_DEFAULTS.gridSize;
  let source = -1;
  let furthest = -Infinity;
  for (const cell of field.burningCells) {
    const projection = (cell % size) * Math.cos(wind) + Math.floor(cell / size) * Math.sin(wind);
    if (projection > furthest) { furthest = projection; source = cell; }
  }
  if (source < 0) return;
  const x = source % size + dx;
  const y = Math.floor(source / size) + dy;
  if (x >= 0 && y >= 0 && x < size && y < size) field.ignite([y * size + x], toMs);
}
