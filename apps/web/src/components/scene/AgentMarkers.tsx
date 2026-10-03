import { useEffect, useMemo } from "react";
import type { ThreeEvent } from "@react-three/fiber";
import { DoubleSide, MeshStandardMaterial, type BufferGeometry } from "three";
import { applyStaleHatch, type StaleHatchUniform } from "./staleHatch.js";
import { freshness } from "./staleness.js";
import type { AgentMarker } from "./sceneEntities.js";
import { sceneTerrain } from "./terrain/sceneTerrain.js";
import { agentCue, crewNumber } from "./models/markerCues.js";
import {
  createChevronGeometry,
  createCrewGeometry,
  createCrossGeometry,
  createScoutGeometry,
  createWarnGeometry,
  createWorkGlyphGeometry,
} from "./models/crewModels.js";

/** Models sit on the ground; the base of each is y = 0 in its own frame. */
const MODEL_LIFT = 1.5;
/** At the fitted zoom 1 scene unit is ~0.7 px; scale up so silhouettes stay readable (legibility over realism). */
const MODEL_SCALE = 1.9;

/** Distinct hue per crew slot, but identity is the tally pegs + label, never hue alone. */
const CREW_COLORS = ["#4FA7E0", "#E0A04A", "#8BBF6B", "#C97BC2", "#D9D26A"];
const SCOUT_COLOR = "#E8DD6B";
const MUTED = "#6c7476";
const MUTED_STALE = "#c3cdcf";

function headingRotationY(agent: AgentMarker): number {
  if (!agent.heading) return 0;
  return -Math.atan2(agent.heading.dz, agent.heading.dx);
}

/** Memoised geometry that is disposed when the component unmounts. */
function useGeometry(factory: () => BufferGeometry, deps: readonly unknown[]): BufferGeometry {
  // deps are supplied by the caller (the rules-of-hooks plugin is not part of this repo's lint config)
  const geometry = useMemo(factory, deps);
  useEffect(() => () => geometry.dispose(), [geometry]);
  return geometry;
}

function GlyphMeshes({ glyph }: { readonly glyph: ReturnType<typeof agentCue>["glyph"] }) {
  const chevron = useGeometry(createChevronGeometry, []);
  const warn = useGeometry(createWarnGeometry, []);
  const cross = useGeometry(createCrossGeometry, []);
  const work = useGeometry(createWorkGlyphGeometry, []);
  const flat = { fog: false } as const;
  switch (glyph) {
    case "none":
      return null;
    case "forward":
      // Two chevrons ahead of the truck: ">>".
      return (
        <group>
          {[28, 38].map((x) => (
            <mesh key={x} geometry={chevron} position={[x, 0, 0]}>
              <meshBasicMaterial color="#F1F4ED" {...flat} />
            </mesh>
          ))}
        </group>
      );
    case "back":
      // Two chevrons pointing back toward the truck: "<<".
      return (
        <group rotation={[0, Math.PI, 0]}>
          {[28, 38].map((x) => (
            <mesh key={x} geometry={chevron} position={[x, 0, 0]}>
              <meshBasicMaterial color="#F1F4ED" {...flat} />
            </mesh>
          ))}
        </group>
      );
    case "work":
      return (
        <mesh geometry={work}>
          <meshBasicMaterial color="#F1F4ED" side={DoubleSide} {...flat} />
        </mesh>
      );
    case "warn":
      return (
        <mesh geometry={warn}>
          <meshBasicMaterial vertexColors {...flat} />
        </mesh>
      );
    case "cross":
      return (
        <mesh geometry={cross}>
          <meshBasicMaterial vertexColors {...flat} />
        </mesh>
      );
  }
}

/**
 * Crew trucks (with tally pegs = crew number), a binocular scout, and a
 * state glyph for each agent state (see models/markerCues.ts). Markers are
 * unaffected by fog so they stay readable under every atmosphere setting.
 */
export function AgentMarkers({
  agents,
  selectedAgentId,
  onInspectAgent,
}: {
  readonly agents: AgentMarker[];
  readonly selectedAgentId: string | null;
  readonly onInspectAgent: (agentId: string) => void;
}) {
  const scout = useGeometry(createScoutGeometry, []);
  const crewOrdinals = agents.filter((a) => a.role === "protection_crew").map((a) => a.id);
  return (
    <group>
      {agents.map((agent, index) => (
        <AgentModel
          key={agent.id}
          agent={agent}
          slot={index}
          crewOrdinal={Math.max(0, crewOrdinals.indexOf(agent.id))}
          selected={agent.id === selectedAgentId}
          scoutGeometry={scout}
          onInspectAgent={onInspectAgent}
        />
      ))}
    </group>
  );
}

function AgentModel({
  agent,
  slot,
  crewOrdinal,
  selected,
  scoutGeometry,
  onInspectAgent,
}: {
  readonly agent: AgentMarker;
  readonly slot: number;
  readonly crewOrdinal: number;
  readonly selected: boolean;
  readonly scoutGeometry: BufferGeometry;
  readonly onInspectAgent: (agentId: string) => void;
}) {
  const cue = agentCue(agent.state);
  const number = crewNumber(agent.callsign, crewOrdinal);
  const crewGeometry = useGeometry(() => createCrewGeometry(number), [number]);
  const fresh = freshness(agent.ageMs);
  // Colour fades toward grey with age as well as opacity: an old position never looks current.
  const color = cue.muted || fresh.stale ? (cue.muted ? MUTED : MUTED_STALE) : agent.role === "scout" ? SCOUT_COLOR : CREW_COLORS[slot % CREW_COLORS.length]!;
  const hatch = useMemo<StaleHatchUniform>(() => ({ uStaleHatch: { value: 0 } }), []);
  hatch.uStaleHatch.value = fresh.stale ? 1 : 0;
  const material = useMemo(() => {
    const m = new MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.7, fog: false });
    applyStaleHatch(m, hatch);
    return m;
  }, [hatch]);
  material.color.set(color);
  material.transparent = fresh.stale;
  material.opacity = fresh.opacity;
  useEffect(() => () => material.dispose(), [material]);
  const y = sceneTerrain.groundY(agent.position.x, agent.position.z) + MODEL_LIFT;
  const handleClick = (event: ThreeEvent<MouseEvent>) => {
    event.stopPropagation();
    onInspectAgent(agent.id);
  };

  return (
    <group position={[agent.position.x, y, agent.position.z]} rotation={[0, headingRotationY(agent), 0]} scale={MODEL_SCALE}>
      <mesh
        geometry={agent.role === "scout" ? scoutGeometry : crewGeometry}
        onClick={handleClick}
        rotation={[cue.lying ? 1.25 : 0, 0, 0]}
        position={[0, cue.lying ? 4 : 0, 0]}
        castShadow
      >
        <primitive object={material} attach="material" />
      </mesh>
      <GlyphMeshes glyph={cue.glyph} />
      {selected ? (
        <mesh position={[0, 0.6, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[27, 30, 40]} />
          <meshBasicMaterial color="#F1F4ED" fog={false} />
        </mesh>
      ) : null}
    </group>
  );
}
