import { PublicScenarioBriefing } from "@ember/domain";
import { SIM_DEFAULTS, type SimScenario } from "@ember/simulation";

/**
 * Pre-start public view of a scenario for the briefing screen. Built field by field rather than
 * spreading the scenario so that `requiredWork`, the terrain seed and anything added to
 * `PublicMap` later stay out of the wire unless deliberately listed here. Parsed through the
 * shared schema so the server can never emit a body the client would reject.
 */
export function publicScenarioBriefing(scenario: SimScenario): PublicScenarioBriefing {
  return PublicScenarioBriefing.parse({
    version: scenario.version,
    gridSize: SIM_DEFAULTS.gridSize,
    cellMeters: SIM_DEFAULTS.cellMeters,
    nodes: scenario.map.nodes.map((node) => ({ id: node.id, x: node.x, y: node.y })),
    edges: scenario.map.edges.map((edge) => ({
      id: edge.id,
      from: edge.from,
      to: edge.to,
      via: edge.via.map((point) => ({ x: point.x, y: point.y })),
      singleCapacity: edge.singleCapacity,
    })),
    sites: scenario.map.sites.map((site) => ({ id: site.id, name: site.name, nodeId: site.nodeId, value: site.value })),
    refuges: scenario.map.refuges.map((refuge) => ({ id: refuge.id, name: refuge.name, nodeId: refuge.nodeId })),
    agents: scenario.agents.map((agent) => ({ callsign: agent.callsign, role: agent.role })),
    initialFireCells: [...scenario.map.initialFireCells],
  });
}
