import type { ThreeEvent } from "@react-three/fiber";
import type { AgentMarker } from "./sceneEntities.js";

/** Cone/octahedron half-height is ~7; this must clear the terrain's max bump (~2.4) by a margin. */
const MARKER_Y = 12;

/** Distinct per-slot colors so identity is never color-only (callsign label always accompanies it). */
const CREW_COLORS = ["#4FA7E0", "#D98C3D", "#8BBF6B", "#C97BC2"];

function colorForAgent(agent: AgentMarker, index: number): string {
  if (agent.role === "scout") return "#E8DD6B";
  return CREW_COLORS[index % CREW_COLORS.length]!;
}

function headingRotationY(agent: AgentMarker): number {
  if (!agent.heading) return 0;
  return -Math.atan2(agent.heading.dz, agent.heading.dx);
}

export function AgentMarkers({
  agents,
  selectedAgentId,
  onInspectAgent,
}: {
  readonly agents: AgentMarker[];
  readonly selectedAgentId: string | null;
  readonly onInspectAgent: (agentId: string) => void;
}) {
  return (
    <group>
      {agents.map((agent, index) => {
        const selected = agent.id === selectedAgentId;
        const color = colorForAgent(agent, index);
        const handleClick = (event: ThreeEvent<MouseEvent>) => {
          event.stopPropagation();
          onInspectAgent(agent.id);
        };

        return (
          <group
            key={agent.id}
            position={[agent.position.x, MARKER_Y, agent.position.z]}
            rotation={[0, headingRotationY(agent), 0]}
          >
            {/* Scout gets a distinct silhouette (octahedron) rather than relying on color alone. */}
            {agent.role === "scout" ? (
              <mesh onClick={handleClick}>
                <octahedronGeometry args={[7, 0]} />
                <meshStandardMaterial color={color} />
              </mesh>
            ) : (
              <mesh onClick={handleClick} rotation={[Math.PI / 2, 0, 0]}>
                <coneGeometry args={[6, 14, 8]} />
                <meshStandardMaterial color={color} />
              </mesh>
            )}
            {agent.state === "working" ? (
              <mesh position={[0, -4, 0]} rotation={[-Math.PI / 2, 0, 0]}>
                <ringGeometry args={[8, 10, 24]} />
                <meshBasicMaterial color={color} />
              </mesh>
            ) : null}
            {selected ? (
              <mesh position={[0, -4, 0]} rotation={[-Math.PI / 2, 0, 0]}>
                <ringGeometry args={[11, 13, 32]} />
                <meshBasicMaterial color="#F1F4ED" />
              </mesh>
            ) : null}
          </group>
        );
      })}
    </group>
  );
}
