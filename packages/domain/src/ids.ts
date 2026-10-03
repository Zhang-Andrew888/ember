import { z } from "zod";

export const AgentId = z.string().brand("AgentId");
export type AgentId = z.infer<typeof AgentId>;

export const SiteId = z.string().brand("SiteId");
export type SiteId = z.infer<typeof SiteId>;

export const EdgeId = z.string().brand("EdgeId");
export type EdgeId = z.infer<typeof EdgeId>;

export const NodeId = z.string().brand("NodeId");
export type NodeId = z.infer<typeof NodeId>;

export const ObjectiveId = z.string().brand("ObjectiveId");
export type ObjectiveId = z.infer<typeof ObjectiveId>;

export const MissionPlanId = z.string().brand("MissionPlanId");
export type MissionPlanId = z.infer<typeof MissionPlanId>;

export const ObservationId = z.string().brand("ObservationId");
export type ObservationId = z.infer<typeof ObservationId>;

export const CommandId = z.string().brand("CommandId");
export type CommandId = z.infer<typeof CommandId>;

export const IncidentId = z.string().brand("IncidentId");
export type IncidentId = z.infer<typeof IncidentId>;

export const ScenarioVersion = z.string().brand("ScenarioVersion");
export type ScenarioVersion = z.infer<typeof ScenarioVersion>;
