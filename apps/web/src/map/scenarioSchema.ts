import { z } from "zod";
import { EdgeId, NodeId, SiteId } from "@ember/domain";

/**
 * Shape of a scenario file as the browser accepts it. Mirrors the public
 * part of the sim lane's PublicMap but is declared here so apps/web never
 * imports sim-lane packages. `requiredWork` is deliberately absent: Zod
 * strips unknown keys, so even a file that carries it cannot leak it onward.
 * Coordinates are metres in a square world (x east, y south).
 */
const Point = z.object({ x: z.number().finite(), y: z.number().finite() });

export const ScenarioTerrain = z
  .object({
    gridSize: z.number().int().positive(),
    cellMeters: z.number().positive(),
    /** Metres, row-major gridSize x gridSize. */
    height: z.array(z.number().finite()),
    /** Fuel/vegetation density multiplier, row-major. */
    fuel: z.array(z.number().finite()),
  })
  .refine((t) => t.height.length === t.gridSize ** 2 && t.fuel.length === t.gridSize ** 2, {
    message: "terrain arrays must hold gridSize^2 values",
  });
export type ScenarioTerrain = z.infer<typeof ScenarioTerrain>;

export const ScenarioFile = z
  .object({
    version: z.string().min(1),
    map: z.object({
      nodes: z.array(z.object({ id: NodeId, x: z.number().finite(), y: z.number().finite() })).min(2),
      edges: z
        .array(
          z.object({
            id: EdgeId,
            from: NodeId,
            to: NodeId,
            via: z.array(Point).default([]),
            singleCapacity: z.boolean().default(false),
          }),
        )
        .min(1),
      sites: z.array(z.object({ id: SiteId, name: z.string(), nodeId: NodeId, value: z.number().positive() })),
      refuges: z.array(z.object({ id: z.string(), name: z.string(), nodeId: NodeId })),
      scoutPoints: z.array(NodeId).default([]),
      terrainSeed: z.string(),
      initialFireCells: z.array(z.number().int().nonnegative()),
    }),
    terrain: ScenarioTerrain.optional(),
    /** Public roster for the briefing screen; only the callsign is kept. */
    agents: z.array(z.object({ callsign: z.string().min(1) })).default([]),
  })
  .superRefine((file, ctx) => {
    const nodeIds = new Set(file.map.nodes.map((node) => node.id as string));
    const need = (id: string, where: string) => {
      if (!nodeIds.has(id)) ctx.addIssue({ code: "custom", message: `${where} references unknown node ${id}` });
    };
    for (const edge of file.map.edges) {
      need(edge.from, `edge ${edge.id}`);
      need(edge.to, `edge ${edge.id}`);
    }
    for (const site of file.map.sites) need(site.nodeId, `site ${site.id}`);
    for (const refuge of file.map.refuges) need(refuge.nodeId, `refuge ${refuge.id}`);
  });
export type ScenarioFile = z.infer<typeof ScenarioFile>;
