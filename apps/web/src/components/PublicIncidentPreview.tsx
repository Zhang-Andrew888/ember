import type { PublicPreview } from "../briefing/briefingInfo.js";
import { SCENE_SIZE } from "../map/worldScale.js";

const WIDTH = 640;
const HEIGHT = 360;
const MAP_X = 50;
const MAP_Y = 18;
const MAP_WIDTH = 540;
const MAP_HEIGHT = 324;

function project(x: number, z: number) {
  return {
    x: MAP_X + ((x + SCENE_SIZE / 2) / SCENE_SIZE) * MAP_WIDTH,
    y: MAP_Y + ((z + SCENE_SIZE / 2) / SCENE_SIZE) * MAP_HEIGHT,
  };
}

export function PublicIncidentPreview({ preview }: { readonly preview: PublicPreview }) {
  const siteNames = preview.sites.map((site) => site.name).join(", ") || "none named";
  const refugeNames = preview.refuges.map((refuge) => refuge.name).join(", ") || "none named";
  const description = `Starting picture with public roads, sites ${siteNames}, refuges ${refugeNames}, and ${preview.initialFireCells.length ? "the initially observed fire area" : "no initially observed fire area"}.`;
  const cellWidth = MAP_WIDTH / preview.gridSize;
  const cellHeight = MAP_HEIGHT / preview.gridSize;

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
            stroke="#8fa39e"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ))}
        {preview.initialFireCells.map((cell) => (
          <rect
            key={cell}
            x={MAP_X + (cell % preview.gridSize) * cellWidth}
            y={MAP_Y + Math.floor(cell / preview.gridSize) * cellHeight}
            width={cellWidth}
            height={cellHeight}
            fill="var(--brief-accent)"
          />
        ))}
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
              <circle cx={pos.x} cy={pos.y} r="5" fill="var(--brief-text)" />
              <text className="briefing__map-label" x={pos.x - 12} y={pos.y + 4} textAnchor="end">{site.name}</text>
            </g>
          );
        })}
        {preview.initialFireCells.length > 0 ? (() => {
          const fire = preview.initialFireCells[0]!;
          return (
            <text
              className="briefing__map-label"
              x={MAP_X + (fire % preview.gridSize) * cellWidth + 22}
              y={MAP_Y + Math.floor(fire / preview.gridSize) * cellHeight - 8}
            >Observed fire</text>
          );
        })() : null}
      </svg>
    </figure>
  );
}
