import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import { DoubleSide, type Group } from "three";

const DROP_COUNT = 24;

/** Hose reach in scene meters: GAME_CHANGES.hoseSuppressRadiusTiles (5) × 25 m cells. */
export const HOSE_REACH_M = 125;
/** Spray width: twice GAME_CHANGES.hoseConeHalfAngleDeg (90°). */
const SPRAY_HALF_ANGLE_RAD = Math.PI / 2;

/**
 * Water/mist spray in front of a crew whose hose is hitting fire (game-changes). Drawn in the
 * truck's own frame (forward = +x), so it turns with the crew: a 180° fan out to `reach`.
 */
export function HoseMist({ reach }: { readonly reach: number }) {
  const group = useRef<Group>(null);
  const seeds = useMemo(
    () =>
      Array.from({ length: DROP_COUNT }, (_, i) => ({
        angle: (((i * 7) % DROP_COUNT) / (DROP_COUNT - 1) - 0.5) * 2 * SPRAY_HALF_ANGLE_RAD * 0.9,
        height: 2 + (i % 4) * 1.5,
        phase: (i * 0.37) % 1,
      })),
    [],
  );

  useFrame(({ clock }) => {
    const g = group.current;
    if (g === null) return;
    const t = clock.getElapsedTime();
    g.children.forEach((child, i) => {
      const seed = seeds[i];
      if (seed === undefined) return;
      // Droplets stream outward from the nozzle and fade in size toward the edge of reach.
      const along = (t * 0.6 + seed.phase) % 1;
      const d = 8 + along * (reach - 8);
      child.position.set(Math.cos(seed.angle) * d, seed.height * (1 - along * 0.6), Math.sin(seed.angle) * d);
      child.scale.setScalar(0.7 + (1 - along) * 0.8);
    });
  });

  return (
    <group>
      <group ref={group}>
        {seeds.map((_, i) => (
          <mesh key={i}>
            <sphereGeometry args={[1.8, 6, 6]} />
            <meshBasicMaterial color="#b8dce8" transparent opacity={0.4} depthWrite={false} fog={false} />
          </mesh>
        ))}
      </group>
      <mesh position={[0, 0.8, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[reach, 24, -SPRAY_HALF_ANGLE_RAD, 2 * SPRAY_HALF_ANGLE_RAD]} />
        <meshBasicMaterial color="#cfeef5" transparent opacity={0.16} side={DoubleSide} depthWrite={false} fog={false} />
      </mesh>
    </group>
  );
}
