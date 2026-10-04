import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import { DoubleSide, type Group } from "three";

const DROP_COUNT = 18;

/**
 * Simple water/mist spray while a crew is working suppression (game-changes hose).
 * Tip of the cone (~58 local units × 1.9 model scale) ≈ 125 m sim reach
 * (GAME_CHANGES.hoseSuppressRadiusTiles = 5 × 25 m).
 */
export function HoseMist({ headingRad }: { readonly headingRad: number }) {
  const group = useRef<Group>(null);
  const seeds = useMemo(
    () =>
      Array.from({ length: DROP_COUNT }, (_, i) => ({
        x: 12 + (i % 6) * 4 + (i % 3) * 0.7,
        y: 2 + (i % 4) * 1.5,
        z: ((i * 17) % 7) - 3,
        phase: i * 0.41,
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
      const pulse = 0.35 + 0.25 * Math.sin(t * 4 + seed.phase);
      child.position.set(seed.x + Math.sin(t * 2 + seed.phase) * 2, seed.y + pulse * 2, seed.z);
      child.scale.setScalar(0.8 + pulse * 0.5);
    });
  });

  return (
    <group ref={group} rotation={[0, headingRad, 0]} position={[8, 0, 0]}>
      {seeds.map((seed, i) => (
        <mesh key={i} position={[seed.x, seed.y, seed.z]}>
          <sphereGeometry args={[1.8, 6, 6]} />
          <meshBasicMaterial color="#b8dce8" transparent opacity={0.35} depthWrite={false} fog={false} />
        </mesh>
      ))}
      <mesh position={[22, 4, 0]} rotation={[0, 0, Math.PI / 2]}>
        <coneGeometry args={[6, 28, 8, 1, true]} />
        <meshBasicMaterial color="#cfeef5" transparent opacity={0.12} side={DoubleSide} depthWrite={false} fog={false} />
      </mesh>
    </group>
  );
}
