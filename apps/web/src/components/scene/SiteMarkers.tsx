import { useCallback, useEffect, useMemo } from "react";
import { DoubleSide, MeshStandardMaterial, type BufferGeometry } from "three";
import { useStaleMaterial } from "./useStaleMaterial.js";
import { freshness } from "./staleness.js";
import type { SiteMarker } from "./sceneEntities.js";
import type { SceneNode } from "../../map/scenarioMap.js";
import { colors } from "../../styles/colors.js";
import { sceneTerrain } from "./terrain/sceneTerrain.js";
import { damageNotches, DAMAGE_NOTCHES, siteCue, siteModelKind } from "./models/markerCues.js";
import { createDamageNotchGeometry, createFenceRingGeometry, createRubbleGeometry, createSiteGeometry } from "./models/siteModels.js";

const SITE_LIFT = 1.2;
/** See MODEL_SCALE in AgentMarkers: sites are also enlarged to read at the fitted zoom. */
const SITE_SCALE = 1.7;

function useGeometry(factory: () => BufferGeometry): BufferGeometry {
  const geometry = useMemo(() => factory(), [factory]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  return geometry;
}

const PROTECTION_TINT: Record<SiteMarker["protectionStatus"], string> = {
  unobserved: "#8b9699",
  unprotected: "#d9cfc0",
  partially_protected: "#e8d9a8",
  destroyed: "#3a2f2b",
};

/**
 * Site models with separate protection and damage indicators (never
 * conflated). Protection is a SHAPE: unobserved = outlined ghost,
 * unprotected = plain building, protection underway = fence-post ring,
 * destroyed = collapsed rubble. Damage is its own notch gauge. Text for
 * both is always in the label (SceneView).
 */
export function SiteMarkers({ sites }: { readonly sites: SiteMarker[] }) {
  return (
    <group>
      {sites.map((site, index) => (
        <SiteModel key={site.id} site={site} index={index} />
      ))}
    </group>
  );
}

function SiteModel({ site, index }: { readonly site: SiteMarker; readonly index: number }) {
  const kind = siteModelKind(site.name, index);
  const cue = siteCue(site.protectionStatus);
  const building = useGeometry(useCallback(() => createSiteGeometry(kind), [kind]));
  const rubble = useGeometry(createRubbleGeometry);
  const fence = useGeometry(createFenceRingGeometry);
  const notch = useGeometry(createDamageNotchGeometry);
  const filled = damageNotches(site.damage);
  const y = sceneTerrain.groundY(site.position.x, site.position.z) + SITE_LIFT;
  const tint = PROTECTION_TINT[site.protectionStatus];
  const fresh = freshness(site.ageMs, site.stale);
  // Unobserved sites are already outline-only ghosts; stale observed sites fade and hatch.
  const material = useStaleMaterial(
    useCallback(() => new MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.85, fog: false }), []),
    tint,
    fresh,
    fresh.stale && !cue.ghost,
  );

  return (
    <group position={[site.position.x, y, site.position.z]} scale={SITE_SCALE}>
      {cue.collapsed ? (
        <mesh geometry={rubble} castShadow>
          <primitive object={material} attach="material" />
        </mesh>
      ) : (
        <mesh geometry={building} castShadow={!cue.ghost}>
          {cue.ghost ? (
            // Nothing is known about this site: draw only its outline, never a solid building.
            <meshBasicMaterial color={tint} wireframe transparent opacity={0.8} fog={false} />
          ) : (
            <primitive object={material} attach="material" />
          )}
        </mesh>
      )}
      {cue.fenceRing ? (
        <mesh geometry={fence}>
          <meshStandardMaterial vertexColors flatShading fog={false} />
        </mesh>
      ) : null}
      {filled !== null ? (
        <group position={[44, 0, 0]}>
          {Array.from({ length: DAMAGE_NOTCHES }, (_, i) => (
            <mesh key={i} geometry={notch} position={[0, 0, (i - (DAMAGE_NOTCHES - 1) / 2) * 5]}>
              {i < filled ? (
                <meshBasicMaterial color={colors.rejected} fog={false} />
              ) : (
                <meshBasicMaterial color="#F1F4ED" wireframe fog={false} />
              )}
            </mesh>
          ))}
        </group>
      ) : null}
    </group>
  );
}

/** Refuge markers are static, public map features - not derived from CoordinatorView. */
export function RefugeMarkers({ refuges }: { readonly refuges: SceneNode[] }) {
  return (
    <group>
      {refuges.map((refuge) => (
        <group
          key={refuge.id}
          position={[refuge.x, sceneTerrain.groundY(refuge.x, refuge.z) + SITE_LIFT, refuge.z]}
        >
          {/* A flat ring + pad: a refuge is a place, not a unit. */}
          <mesh rotation={[-Math.PI / 2, 0, 0]}>
            <ringGeometry args={[14, 18, 28]} />
            <meshBasicMaterial color={colors.refuge} side={DoubleSide} fog={false} />
          </mesh>
          <mesh>
            <cylinderGeometry args={[11, 11, 2.4, 20]} />
            <meshStandardMaterial color={colors.refuge} fog={false} />
          </mesh>
        </group>
      ))}
    </group>
  );
}
