import { useEffect, useMemo } from "react";
import { BufferGeometry, Float32BufferAttribute, Uint16BufferAttribute, type Texture } from "three";
import { buildRibbonData } from "./ribbon.js";
import { createChevronTexture, createDashTexture, createSolidTexture } from "./patternTextures.js";
import type { RouteLine, RoutePhase } from "./sceneLayers.js";

const ROUTE_Y = 8;
const THIN = 4.5;
const THICK = 8;
const TILE: Record<RoutePhase, number> = { approach: 28, work: 40, return: 22 };
const ROUTE_COLOR = "#F1F4ED";
const ROUTE_COLOR_DIM = "#B9C7C2";

function useRouteTextures(): Record<RoutePhase, Texture> {
  const textures = useMemo(
    () => ({
      approach: createChevronTexture(ROUTE_COLOR),
      work: createSolidTexture(ROUTE_COLOR),
      return: createDashTexture(ROUTE_COLOR),
    }),
    [],
  );
  useEffect(
    () => () => {
      for (const texture of Object.values(textures)) texture.dispose();
    },
    [textures],
  );
  return textures;
}

function RouteRibbon({ line, texture }: { readonly line: RouteLine; readonly texture: Texture }) {
  const geometry = useMemo(() => {
    const data = buildRibbonData(line.points, line.selected ? THICK : THIN, ROUTE_Y, TILE[line.phase]);
    const geo = new BufferGeometry();
    geo.setAttribute("position", new Float32BufferAttribute(data.positions, 3));
    geo.setAttribute("uv", new Float32BufferAttribute(data.uvs, 2));
    geo.setIndex(new Uint16BufferAttribute(data.indices, 1));
    return geo;
  }, [line.points, line.selected, line.phase]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  return (
    <mesh geometry={geometry} renderOrder={5} frustumCulled={false}>
      <meshBasicMaterial
        map={texture}
        transparent
        depthWrite={false}
        color={line.selected ? ROUTE_COLOR : ROUTE_COLOR_DIM}
        opacity={line.selected ? 1 : 0.85}
      />
    </mesh>
  );
}

/**
 * Route emphasis (docs/FRONTEND.md layer 6): the reportable plan for each
 * agent. Thin lines thicken on selection. Phase is carried by pattern
 * (chevrons = approach, solid = work, dashes = return) and by the label,
 * never by colour alone.
 */
export function RouteLayer({ lines }: { readonly lines: readonly RouteLine[] }) {
  const textures = useRouteTextures();
  return (
    <group>
      {lines.map((line) => (
        <RouteRibbon key={line.key} line={line} texture={textures[line.phase]} />
      ))}
    </group>
  );
}
