import { useEffect, useMemo } from "react";
import type { ThreeEvent } from "@react-three/fiber";
import { BufferGeometry, Float32BufferAttribute, LineBasicMaterial, Line as ThreeLine } from "three";
import { SCENE_SIZE } from "../../map/worldScale.js";
import { sceneTerrain } from "./terrain/sceneTerrain.js";

export interface MapDestinationPickerProps {
  readonly active: boolean;
  readonly from: { readonly x: number; readonly z: number } | null;
  readonly to: { readonly x: number; readonly z: number } | null;
  readonly onPickScene: (x: number, z: number) => void;
}

function PreviewSegment({ from, to }: { readonly from: { x: number; z: number }; readonly to: { x: number; z: number } }) {
  const line = useMemo(() => {
    const y0 = sceneTerrain.groundY(from.x, from.z) + 4;
    const y1 = sceneTerrain.groundY(to.x, to.z) + 4;
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new Float32BufferAttribute([from.x, y0, from.z, to.x, y1, to.z], 3));
    const material = new LineBasicMaterial({ color: "#70d6d1", transparent: true, opacity: 0.85 });
    return new ThreeLine(geometry, material);
  }, [from, to]);

  useEffect(
    () => () => {
      line.geometry.dispose();
      line.material.dispose();
    },
    [line],
  );

  return <primitive object={line} />;
}

/** Invisible ground plane for destination clicks plus a preview line and marker. */
export function MapDestinationPicker({ active, from, to, onPickScene }: MapDestinationPickerProps) {
  const groundY = to === null ? 2 : sceneTerrain.groundY(to.x, to.z) + 2;

  const handlePointerDown = (event: ThreeEvent<PointerEvent>) => {
    if (!active) return;
    event.stopPropagation();
    onPickScene(event.point.x, event.point.z);
  };

  return (
    <>
      {active ? (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.5, 0]} onPointerDown={handlePointerDown}>
          <planeGeometry args={[SCENE_SIZE, SCENE_SIZE]} />
          <meshBasicMaterial visible={false} />
        </mesh>
      ) : null}
      {from !== null && to !== null ? <PreviewSegment from={from} to={to} /> : null}
      {to !== null ? (
        <mesh position={[to.x, groundY, to.z]}>
          <sphereGeometry args={[8, 16, 16]} />
          <meshStandardMaterial color="#70d6d1" emissive="#2a6a66" emissiveIntensity={0.35} />
        </mesh>
      ) : null}
    </>
  );
}
