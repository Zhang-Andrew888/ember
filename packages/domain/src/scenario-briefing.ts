import { z } from "zod";
import { EdgeId, NodeId, ScenarioVersion, SiteId } from "./ids.js";
import { AgentRole } from "./records.js";

/**
 * What a client may know about an incident's scenario before it starts: the public road graph,
 * named sites and refuges, the crew roster and the briefed initial fire patch. This is the
 * pre-start half of the REST contract (`GET /scenario`, `POST /incidents`), so the briefing can
 * draw the starting picture the server will actually run instead of a bundled copy.
 *
 * Deliberately absent: `requiredWork` (site effort is learned on arrival), the private world seed,
 * terrain layers and any fire truth beyond the briefed ignition. Zod strips unknown keys, so a
 * server that accidentally includes more cannot leak it through a parsing client.
 */
const finiteMeters = z.number().finite();

export const ScenarioBriefingPoint = z.object({ x: finiteMeters, y: finiteMeters });
export type ScenarioBriefingPoint = z.infer<typeof ScenarioBriefingPoint>;

export const ScenarioBriefingNode = z.object({ id: NodeId, x: finiteMeters, y: finiteMeters });
export type ScenarioBriefingNode = z.infer<typeof ScenarioBriefingNode>;

export const ScenarioBriefingEdge = z.object({
  id: EdgeId,
  from: NodeId,
  to: NodeId,
  /** Interior polyline points; endpoints are the from/to node positions. */
  via: z.array(ScenarioBriefingPoint).default([]),
  singleCapacity: z.boolean().default(false),
});
export type ScenarioBriefingEdge = z.infer<typeof ScenarioBriefingEdge>;

export const ScenarioBriefingSite = z.object({
  id: SiteId,
  name: z.string().min(1),
  nodeId: NodeId,
  value: z.number().positive(),
});
export type ScenarioBriefingSite = z.infer<typeof ScenarioBriefingSite>;

export const ScenarioBriefingRefuge = z.object({ id: z.string().min(1), name: z.string().min(1), nodeId: NodeId });
export type ScenarioBriefingRefuge = z.infer<typeof ScenarioBriefingRefuge>;

export const ScenarioBriefingAgent = z.object({ callsign: z.string().min(1), role: AgentRole });
export type ScenarioBriefingAgent = z.infer<typeof ScenarioBriefingAgent>;

export const PublicScenarioBriefing = z
  .object({
    version: ScenarioVersion,
    /** Fire grid dimensions; the world is a square of gridSize x cellMeters metres per side. */
    gridSize: z.number().int().positive(),
    cellMeters: z.number().positive(),
    nodes: z.array(ScenarioBriefingNode).min(1),
    edges: z.array(ScenarioBriefingEdge),
    sites: z.array(ScenarioBriefingSite),
    refuges: z.array(ScenarioBriefingRefuge),
    agents: z.array(ScenarioBriefingAgent),
    /** Flat grid indices of the briefed initial burning patch. */
    initialFireCells: z.array(z.number().int().nonnegative()),
  })
  .superRefine((briefing, ctx) => {
    const nodeIds = new Set<string>(briefing.nodes.map((node) => node.id));
    const need = (id: string, where: string): void => {
      if (!nodeIds.has(id)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${where} references unknown node ${id}` });
    };
    for (const edge of briefing.edges) {
      need(edge.from, `edge ${edge.id}`);
      need(edge.to, `edge ${edge.id}`);
    }
    for (const site of briefing.sites) need(site.nodeId, `site ${site.id}`);
    for (const refuge of briefing.refuges) need(refuge.nodeId, `refuge ${refuge.id}`);
    const cellCount = briefing.gridSize * briefing.gridSize;
    for (const cell of briefing.initialFireCells) {
      if (cell >= cellCount) ctx.addIssue({ code: z.ZodIssueCode.custom, message: `fire cell ${cell} is off the grid` });
    }
  });
export type PublicScenarioBriefing = z.infer<typeof PublicScenarioBriefing>;

/** Response body of `GET /scenario`. */
export const ScenarioBriefingResponse = z.object({
  protocolVersion: z.number().int(),
  scenario: PublicScenarioBriefing,
});
export type ScenarioBriefingResponse = z.infer<typeof ScenarioBriefingResponse>;
