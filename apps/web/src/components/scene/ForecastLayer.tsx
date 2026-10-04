import { useEffect, useMemo } from "react";
import { BufferGeometry, Float32BufferAttribute, Uint16BufferAttribute } from "three";
import { buildRibbonData, subdividePolyline } from "./ribbon.js";
import { sceneTerrain } from "./terrain/sceneTerrain.js";
import { createHatchTexture } from "./patternTextures.js";
import type { ForecastBand, ForecastLayer as ForecastLayerData } from "./sceneLayers.js";
import { colors } from "../../styles/colors.js";

const FORECAST_LIFT = 3;
const HATCH_TILE = 36;

function BandRibbon({ band, trusted }: { readonly band: ForecastBand; readonly trusted: boolean }) {
  const texture = useMemo(() => createHatchTexture(colors.forecastEnvelope), []);
  useEffect(() => () => texture.dispose(), [texture]);
  const geometry = useMemo(() => {
    const data = buildRibbonData(
      subdividePolyline(band.points, 18),
      band.widthUnits,
      (x, z) => sceneTerrain.groundY(x, z) + FORECAST_LIFT,
      HATCH_TILE,
    );
    const geo = new BufferGeometry();
    geo.setAttribute("position", new Float32BufferAttribute(data.positions, 3));
    geo.setAttribute("uv", new Float32BufferAttribute(data.uvs, 2));
    geo.setIndex(new Uint16BufferAttribute(data.indices, 1));
    return geo;
  }, [band.points, band.widthUnits]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  // The hatch repeats across the width as well as along it, so scale v to keep stripes square-ish.
  return (
    <mesh geometry={geometry} renderOrder={3} frustumCulled={false}>
      <meshBasicMaterial map={texture} transparent depthWrite={false} opacity={trusted ? 0.9 : 0.35} />
    </mesh>
  );
}

/**
 * Coordinator forecast envelope (docs/FRONTEND.md layer 4): translucent
 * magenta hatching (colors.forecastEnvelope), never identical to observed flames. Ribbon width encodes
 * arrival-time uncertainty; an unreliable or rebuilding forecast is dimmed
 * and labelled as such in the legend and band labels.
 */
export function ForecastLayer({ layer }: { readonly layer: ForecastLayerData }) {
  return (
    <group>
      {layer.bands.map((band) => (
        <BandRibbon key={band.key} band={band} trusted={layer.trusted} />
      ))}
    </group>
  );
}
