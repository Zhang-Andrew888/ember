import { z } from "zod";
import {
  AgentId,
  CommandId,
  EdgeId,
  MissionPlanId,
  NodeId,
  ObjectiveId,
  ObservationId,
  ScenarioVersion,
  SiteId,
} from "./ids.js";
import { Meters, SequenceNumber, SimTimeMs, WallTimeMs, WorkUnits } from "./units.js";
import { AgentPosition, MapPoint } from "./position.js";

export const AgentRole = z.enum(["protection_crew", "scout"]);
export type AgentRole = z.infer<typeof AgentRole>;

export const AgentState = z.enum([
  "idle",
  "approaching",
  "working",
  "withdrawing",
  "retreating",
  "lost",
]);
export type AgentState = z.infer<typeof AgentState>;

// ---------- Scenario ----------

export const Scenario = z.object({
  version: ScenarioVersion,
  /** Road graph and site/refuge positions, shareable with all agents. */
  publicMap: z.unknown(),
  publicBriefing: z.string(),
  /** Hidden world parameters: wind shift time, spread multiplier, random seed. */
  privateWorldParameters: z.unknown(),
  configurationHash: z.string(),
});
export type Scenario = z.infer<typeof Scenario>;

// ---------- Agent (truth state) ----------

export const Agent = z.object({
  id: AgentId,
  role: AgentRole,
  callsign: z.string(),
  position: AgentPosition,
  state: AgentState,
  objectiveRevision: SequenceNumber,
  knowledgeRevision: SequenceNumber,
  planRevision: SequenceNumber,
});
export type Agent = z.infer<typeof Agent>;

// ---------- Site ----------

export const Site = z.object({
  id: SiteId,
  name: z.string(),
  nodeId: NodeId,
  requiredWork: WorkUnits,
  completedWork: WorkUnits,
  /** Normalized accumulated damage; reaches 1 on destruction. */
  damage: z.number().min(0).max(1),
  value: z.number().positive(),
  destroyed: z.boolean(),
});
export type Site = z.infer<typeof Site>;

// ---------- Observation ----------

const CellObservationFields = z.object({
  kind: z.literal("cell"),
  /** Flat index in the 64×64 terrain grid (row-major). Replaces the legacy pseudo-edge `"grid"`. */
  gridCellIndex: z.number().int().nonnegative().max(4095),
  burnState: z.enum(["unburned", "burning", "burned"]),
});

const SiteObservationFields = z.object({
  kind: z.literal("site"),
  siteId: SiteId,
  completedWork: WorkUnits,
  damage: z.number().min(0).max(1),
  destroyed: z.boolean(),
});

export const ObservedField = z.discriminatedUnion("kind", [
  CellObservationFields,
  SiteObservationFields,
]);
export type ObservedField = z.infer<typeof ObservedField>;

export const SpatialFootprint = z.object({
  centerX: Meters,
  centerY: Meters,
  radius: Meters,
});
export type SpatialFootprint = z.infer<typeof SpatialFootprint>;

export const Observation = z.object({
  id: ObservationId,
  sourceAgentId: AgentId,
  observedAt: SimTimeMs,
  receivedAt: SimTimeMs,
  spatialFootprint: SpatialFootprint,
  observedFields: z.array(ObservedField),
});
export type Observation = z.infer<typeof Observation>;

// ---------- Evidence reference ----------

export const EvidenceKind = z.enum(["sensor_observation", "agent_report"]);
export type EvidenceKind = z.infer<typeof EvidenceKind>;

export const EvidenceReference = z.object({
  kind: EvidenceKind,
  sourceRecordId: z.string(),
  sourceAgentId: AgentId,
  timestamp: SimTimeMs,
});
export type EvidenceReference = z.infer<typeof EvidenceReference>;

// ---------- Mission work (structure vs fire; not incident end) ----------

/**
 * What timed work at the mission anchor accomplishes.
 * - `protect_structure`: site `completedWork` reduces structure damage (not burn spread).
 * - `suppress_fire`: containment work on one grid cell (burn progression; deterministic slice TBD in sim).
 * Incident terminal `fire_extinguished` (EndReason) is a world outcome, not a crew work class.
 */
export const MissionWork = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("protect_structure"),
    siteId: SiteId,
  }),
  z.object({
    kind: z.literal("suppress_fire"),
    gridCellIndex: z.number().int().nonnegative().max(4095),
  }),
]);
export type MissionWork = z.infer<typeof MissionWork>;

// ---------- Objective ----------

export const ObjectiveKind = z.enum([
  "protect_site",
  /** Direct a crew to perform fire suppression / containment at a grid cell (see MissionWork.suppress_fire). */
  "contain_fire",
  "scout_location",
  "return_to_refuge",
  "hold",
  /** Planner must not use the targeted road edge (corridor segment). */
  "avoid_corridor",
  /** Travel in a world compass direction, stopping at a safe road node. */
  "move_direction",
]);
export type ObjectiveKind = z.infer<typeof ObjectiveKind>;

/** World north is increasing map y (increasing scene z); east is increasing x. */
export const CompassDirection = z.preprocess(
  (value) => typeof value === "string" ? value.trim().toLowerCase().replace(/[\s-]+/g, "") : value,
  z.enum(["north", "northeast", "east", "southeast", "south", "southwest", "west", "northwest"]),
);
export type CompassDirection = z.infer<typeof CompassDirection>;

/** An order is bounded by 1,200 m; omission means at most 600 m, ending at a safe road node. */
export const MovementDirective = z.object({
  direction: CompassDirection,
  maxDistanceMeters: z.number().positive().max(1200).default(600),
  stopRule: z.literal("safe_road_node").default("safe_road_node"),
});
export type MovementDirective = z.infer<typeof MovementDirective>;

export const ObjectiveConstraints = z.object({
  workInterval: z
    .object({ minMs: SimTimeMs, maxMs: SimTimeMs })
    .optional(),
  deadline: SimTimeMs.optional(),
  /**
   * For `contain_fire`: optional explicit cell anchor (decimal string also allowed in `targetId`).
   * Duration is still expressed via issued plan `workInterval` once committed.
   */
  gridCellIndex: z.number().int().nonnegative().max(4095).optional(),
});
export type ObjectiveConstraints = z.infer<typeof ObjectiveConstraints>;

export const Objective = z.object({
  id: ObjectiveId,
  recipientId: AgentId,
  kind: ObjectiveKind,
  /**
   * SiteId, corridor EdgeId, grid cell index (decimal string for `contain_fire`), or null for hold.
   */
  targetId: z.string().nullable(),
  constraints: ObjectiveConstraints,
  movement: MovementDirective.optional(),
  issueSequence: SequenceNumber,
}).superRefine((objective, context) => {
  if (objective.kind === "move_direction" && objective.movement === undefined) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["movement"], message: "A movement objective needs an unambiguous compass direction." });
  }
  if (objective.kind === "move_direction" && objective.targetId !== null) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["targetId"], message: "A directional movement objective uses its movement directive, not a target ID." });
  }
});
export type Objective = z.infer<typeof Objective>;

// ---------- MissionPlan ----------

export const TimedLeg = z.object({
  edgeId: EdgeId,
  direction: z.enum(["forward", "reverse"]),
  departMs: SimTimeMs,
  arriveMs: SimTimeMs,
});
export type TimedLeg = z.infer<typeof TimedLeg>;

/** Off-road travel uses half of the road speed. Coordinates are in map meters. */
export const OffroadTimedLeg = z.object({
  kind: z.literal("offroad"),
  start: MapPoint,
  end: MapPoint,
  departMs: SimTimeMs,
  arriveMs: SimTimeMs,
  speedFactor: z.literal(0.5).default(0.5),
}).refine((leg) => leg.arriveMs > leg.departMs, {
  message: "Off-road arrival must follow departure",
  path: ["arriveMs"],
}).refine((leg) => leg.start.x !== leg.end.x || leg.start.y !== leg.end.y, {
  message: "Off-road leg must have a destination distinct from its start",
  path: ["end"],
});
export type OffroadTimedLeg = z.infer<typeof OffroadTimedLeg>;

export const MissionPlan = z.object({
  id: MissionPlanId,
  recipientId: AgentId,
  knowledgeRevision: SequenceNumber,
  timedLegs: z.array(TimedLeg),
  /** Future off-road movement legs; road legs remain unchanged. */
  offroadLegs: z.array(OffroadTimedLeg).optional(),
  /** Sim-time window for on-scene work; length is the committed duration for structure or containment work. */
  workInterval: z.object({ startMs: SimTimeMs, endMs: SimTimeMs }),
  /**
   * When set, names work class and location. Omitted legacy plans imply structure protection via
   * simulator `workSiteId` on commit.
   */
  work: MissionWork.optional(),
  refugeId: NodeId,
  reservationRevision: SequenceNumber,
  /** Non-null when a constraint caps the mission (e.g. forecast horizon). */
  limitingReason: z.string().nullable(),
});
export type MissionPlan = z.infer<typeof MissionPlan>;

/** Reportable outcome after containment work completes or fails (coordinator-visible). */
export const ContainmentOutcome = z.enum(["succeeded", "failed"]);
export type ContainmentOutcome = z.infer<typeof ContainmentOutcome>;

export const ContainmentWorkResult = z.object({
  agentId: AgentId,
  gridCellIndex: z.number().int().nonnegative().max(4095),
  outcome: ContainmentOutcome,
  /** e.g. `safety_refused`, `duration_elapsed`, `cell_burned_out` */
  reasonCode: z.string(),
  reportedAt: SimTimeMs,
});
export type ContainmentWorkResult = z.infer<typeof ContainmentWorkResult>;

// ---------- DecisionEvent ----------

export const DecisionType = z.enum([
  "mission_start",
  "mission_update",
  "withdrawal_triggered",
  "retreat_triggered",
  "stranded_reported",
  "objective_rejected",
  /** Containment work finished with the cell no longer spreading (sim applies mechanics later). */
  "containment_succeeded",
  /** Containment work ended without success (includes safety refusal before or during work). */
  "containment_failed",
  "idle",
]);
export type DecisionType = z.infer<typeof DecisionType>;

export const DecisionEvent = z.object({
  sequence: SequenceNumber,
  tick: SimTimeMs,
  agentId: AgentId,
  type: DecisionType,
  reasonCode: z.string(),
  evidenceIds: z.array(z.string()),
  actualAction: z.string(),
});
export type DecisionEvent = z.infer<typeof DecisionEvent>;

// ---------- CommandReceipt ----------

export const CommandStatus = z.enum([
  "received",
  "accepted",
  "rejected",
  "incident_ended",
  "stale",
  "clarification_required",
]);
export type CommandStatus = z.infer<typeof CommandStatus>;

export const CommandReceipt = z.object({
  commandId: CommandId,
  status: CommandStatus,
  recipientId: AgentId.nullable(),
  appliedTick: SimTimeMs.nullable(),
  explanation: z.string(),
  planRevision: SequenceNumber.nullable(),
});
export type CommandReceipt = z.infer<typeof CommandReceipt>;

// ---------- IncidentEnd ----------

export const EndReason = z.enum([
  "time_expired",
  "fire_extinguished",
  "all_sites_resolved",
  "all_protection_crews_lost",
]);
export type EndReason = z.infer<typeof EndReason>;

export const IncidentEnd = z.object({
  tick: SimTimeMs,
  wallElapsedMs: WallTimeMs,
  /** Every end condition that was true on the terminal step. */
  matchingReasons: z.array(EndReason),
  /** Display precedence from ARCHITECTURE.md: loss > resolved > extinguished > expired. */
  displayReason: EndReason,
  finalSnapshotHash: z.string(),
});
export type IncidentEnd = z.infer<typeof IncidentEnd>;
