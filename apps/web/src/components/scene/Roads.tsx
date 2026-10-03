import { useMemo } from "react";
import { scenarioMap } from "../../map/scenarioMap.js";
import { colors } from "../../styles/colors.js";

const ROAD_WIDTH = 6;
const ROAD_HEIGHT = 1;
/** Constant road elevation, well above the terrain's max bump height (~2.4). */
const ROAD_Y = 6;

interface RoadSegment {
  readonly key: string;
  readonly x: number;
  readonly z: number;
  readonly length: number;
  readonly rotationY: number;
}

export function Roads() {
  const segments = useMemo<RoadSegment[]>(() => {
    const result: RoadSegment[] = [];
    for (const edge of scenarioMap.edges.values()) {
      const from = scenarioMap.nodes.get(edge.fromNodeId);
      const to = scenarioMap.nodes.get(edge.toNodeId);
      if (!from || !to) continue;
      const dx = to.x - from.x;
      const dz = to.z - from.z;
      result.push({
        key: edge.id,
        x: (from.x + to.x) / 2,
        z: (from.z + to.z) / 2,
        length: Math.hypot(dx, dz),
        rotationY: -Math.atan2(dz, dx),
      });
    }
    return result;
  }, []);

  return (
    <group>
      {segments.map((segment) => (
        <mesh
          key={segment.key}
          position={[segment.x, ROAD_Y, segment.z]}
          rotation={[0, segment.rotationY, 0]}
        >
          <boxGeometry args={[segment.length, ROAD_HEIGHT, ROAD_WIDTH]} />
          <meshStandardMaterial color={colors.road} roughness={0.9} />
        </mesh>
      ))}
    </group>
  );
}
