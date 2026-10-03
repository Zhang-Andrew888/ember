import { useEffect, useMemo } from "react";
import { BufferGeometry, Float32BufferAttribute, Uint16BufferAttribute, Uint32BufferAttribute } from "three";
import { scenarioMap } from "../../map/activeScenario.js";
import { colors } from "../../styles/colors.js";
import { buildRibbonData, subdividePolyline } from "./ribbon.js";
import { createDashTexture } from "./patternTextures.js";
import { sceneTerrain } from "./terrain/sceneTerrain.js";

const ROAD_HALF_WIDTH = 5;
const ROAD_LIFT = 1.2;
const MARKING_LIFT = 1.6;
const STEP = 18;

function toGeometry(data: ReturnType<typeof buildRibbonData>): BufferGeometry {
  const geo = new BufferGeometry();
  geo.setAttribute("position", new Float32BufferAttribute(data.positions, 3));
  geo.setAttribute("uv", new Float32BufferAttribute(data.uvs, 2));
  geo.setIndex(
    data.indices.length > 65535 ? new Uint32BufferAttribute(data.indices, 1) : new Uint16BufferAttribute(data.indices, 1),
  );
  geo.computeVertexNormals();
  return geo;
}

/**
 * Road polylines draped on the terrain. Single-capacity (constrained)
 * segments carry an extra dashed centre marking, so "one crew at a time"
 * is a shape on the road, not only a colour.
 */
export function Roads() {
  const { roads, markings } = useMemo(() => {
    const groundAt = (lift: number) => (x: number, z: number) => sceneTerrain.groundY(x, z) + lift;
    const roadGeos: BufferGeometry[] = [];
    const markingGeos: BufferGeometry[] = [];
    for (const edge of scenarioMap.edges.values()) {
      const points = subdividePolyline(edge.points, STEP);
      roadGeos.push(toGeometry(buildRibbonData(points, ROAD_HALF_WIDTH, groundAt(ROAD_LIFT), 30)));
      if (edge.singleCapacity) {
        markingGeos.push(toGeometry(buildRibbonData(points, 1.6, groundAt(MARKING_LIFT), 12)));
      }
    }
    return { roads: roadGeos, markings: markingGeos };
  }, []);
  const dash = useMemo(() => createDashTexture("#E6C36B"), []);

  useEffect(
    () => () => {
      for (const geo of [...roads, ...markings]) geo.dispose();
      dash.dispose();
    },
    [roads, markings, dash],
  );

  return (
    <group>
      {roads.map((geo, i) => (
        <mesh key={`road-${i}`} geometry={geo} renderOrder={2} frustumCulled={false}>
          <meshStandardMaterial color={colors.road} roughness={0.95} polygonOffset polygonOffsetFactor={-2} />
        </mesh>
      ))}
      {markings.map((geo, i) => (
        <mesh key={`mark-${i}`} geometry={geo} renderOrder={2} frustumCulled={false}>
          <meshBasicMaterial map={dash} transparent depthWrite={false} polygonOffset polygonOffsetFactor={-3} />
        </mesh>
      ))}
    </group>
  );
}
