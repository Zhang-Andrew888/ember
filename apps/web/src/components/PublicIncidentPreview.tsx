import type { PublicPreview } from "../briefing/briefingInfo.js";
import { FULL_SCENE_BOUNDS, fitPreview, previewBounds } from "../briefing/previewFit.js";
import { SCENE_SIZE } from "../map/worldScale.js";

const WIDTH = 640;
const HEIGHT = 360;
// Side inset leaves room for the labels drawn left of sites and right of refuges.
const VIEWPORT = { width: WIDTH, height: HEIGHT, padX: 104, padY: 30 };

export function PublicIncidentPreview({ preview }: { readonly preview: PublicPreview }) {
  const siteNames = preview.sites.map((site) => site.name).join(", ") || "none named";
  const refugeNames = preview.refuges.map((refuge) => refuge.name).join(", ") || "none named";
  const description = `Starting picture with public roads, sites ${siteNames}, refuges ${refugeNames}, and ${preview.initialFireCells.length ? "the initially observed fire area" : "no initially observed fire area"}.`;

  const frame = fitPreview(previewBounds(preview) ?? FULL_SCENE_BOUNDS, VIEWPORT);
  const project = (x: number, z: number) => ({ x: frame.offsetX + x * frame.scale, y: frame.offsetY + z * frame.scale });
  const cellSize = SCENE_SIZE / preview.gridSize;
  const cellOrigin = (cell: number) =>
    project(-SCENE_SIZE / 2 + (cell % preview.gridSize) * cellSize, -SCENE_SIZE / 2 + Math.floor(cell / preview.gridSize) * cellSize);
  const cellPx = cellSize * frame.scale;

  return (
    <figure className="briefing__preview">
      <figcaption>Starting picture</figcaption>
      <svg className="briefing__map" viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label={description}>
        {preview.roads.map((road) => (
          <polyline
            key={road.id}
            points={road.points.map((point) => {
              const pos = project(point.x, point.z);
              return `${pos.x},${pos.y}`;
            }).join(" ")}
            fill="none"
            stroke="var(--brief-road)"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ))}
        {preview.initialFireCells.map((cell) => {
          const pos = cellOrigin(cell);
          return <rect key={cell} x={pos.x} y={pos.y} width={cellPx} height={cellPx} fill="var(--brief-accent)" />;
        })}
        {preview.refuges.map((refuge) => {
          const pos = project(refuge.x, refuge.z);
          return (
            <g key={refuge.name}>
              <rect x={pos.x - 5} y={pos.y - 5} width="10" height="10" fill="var(--brief-text)" />
              <text className="briefing__map-label" x={pos.x + 12} y={pos.y + 4}>{refuge.name}</text>
            </g>
          );
        })}
        {preview.sites.map((site) => {
          const pos = project(site.x, site.z);
          return (
            <g key={site.name}>
              <circle cx={pos.x} cy={pos.y} r="5.5" fill="var(--brief-text)" />
              <text className="briefing__map-label" x={pos.x - 12} y={pos.y + 4} textAnchor="end">{site.name}</text>
            </g>
          );
        })}
        {preview.initialFireCells.length > 0 ? (() => {
          const pos = cellOrigin(preview.initialFireCells[0]!);
          return (
            <text className="briefing__map-label briefing__map-label--fire" x={pos.x - 8} y={pos.y + cellPx / 2 + 4} textAnchor="end">
              Observed fire
            </text>
          );
        })() : null}
      </svg>
    </figure>
  );
}
