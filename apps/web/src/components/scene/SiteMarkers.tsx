import { DoubleSide } from "three";
import type { SiteMarker } from "./sceneEntities.js";
import type { SceneNode } from "../../map/scenarioMap.js";
import { colors } from "../../styles/colors.js";

/** Comfortably clears the terrain's max bump height (~2.4) plus marker half-height. */
const MARKER_Y = 10;

const PROTECTION_COLOR: Record<SiteMarker["protectionStatus"], string> = {
  unobserved: "#6B7678",
  unprotected: colors.rejected,
  partially_protected: "#E0A64E",
  destroyed: "#5A1F1B",
};

/** Site markers with separate protection and damage indicators (never conflated). */
export function SiteMarkers({ sites }: { readonly sites: SiteMarker[] }) {
  return (
    <group>
      {sites.map((site) => (
        <group key={site.id} position={[site.position.x, MARKER_Y, site.position.z]}>
          <mesh>
            <cylinderGeometry args={[9, 9, 10, 10]} />
            <meshStandardMaterial
              color={PROTECTION_COLOR[site.protectionStatus]}
              opacity={site.stale ? 0.55 : 1}
              transparent={site.stale}
            />
          </mesh>
          {site.damage !== null && site.damage > 0 ? (
            <mesh position={[0, 11, 0]}>
              <ringGeometry args={[9, 9 + site.damage * 6, 24]} />
              <meshBasicMaterial color={colors.rejected} side={DoubleSide} />
            </mesh>
          ) : null}
        </group>
      ))}
    </group>
  );
}

/** Refuge markers are static, public map features - not derived from CoordinatorView. */
export function RefugeMarkers({ refuges }: { readonly refuges: SceneNode[] }) {
  return (
    <group>
      {refuges.map((refuge) => (
        <mesh key={refuge.id} position={[refuge.x, MARKER_Y, refuge.z]}>
          <cylinderGeometry args={[11, 11, 4, 16]} />
          <meshStandardMaterial color={colors.refuge} />
        </mesh>
      ))}
    </group>
  );
}
