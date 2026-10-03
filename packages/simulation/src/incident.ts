import {
  AgentId,
  CoordinatorReportEntry,
  CoordinatorView,
  IncidentEnd,
  IncidentId,
  Observation,
  SequenceNumber,
  SimTimeMs,
  WIRE_PROTOCOL_VERSION,
  WorkUnits,
  type AgentPosition,
  type CoordinatorAgentPlanView,
  type CoordinatorForecastView,
  type DomainEvent,
  type EndReason,
  type SiteId,
} from "@ember/domain";
import { KnowledgeStore, STALE_AFTER_MS, type AgentKnowledgeSnapshot } from "@ember/knowledge";
import { SIM_DEFAULTS, cellsWithin, hashValue } from "./model/index.js";
import { SimInput, type AppliedInput, type InputReceipt } from "./inputs.js";
import { SimScenario } from "./scenario.js";
import { validateScenario } from "./validate.js";
import { World, derivePrivateParameters, type PrivateOverrides, type SimNotice } from "./world.js";

export interface IncidentOptions {
  readonly scenario: SimScenario;
  readonly seed: string;
  readonly overrides?: PrivateOverrides;
  readonly incidentId?: string;
}

export interface AgentProjection {
  readonly agentId: AgentId;
  readonly simTimeMs: number;
  readonly role: string;
  readonly callsign: string;
  readonly position: AgentPosition;
  readonly state: string;
  readonly objectiveRevision: number;
  readonly planRevision: number;
  readonly knowledgeRevision: number;
  readonly commitment: {
    readonly planId: string;
    readonly legIndex: number;
    readonly legCount: number;
    readonly mode: string;
    readonly working: boolean;
  } | null;
  readonly knowledge: AgentKnowledgeSnapshot;
  readonly inputHash: string;
}

export interface TruthSnapshot {
  readonly timeMs: number;
  readonly cellState: Uint8Array;
  readonly cellIgnitedAtMs: Float64Array;
  readonly agents: readonly { id: string; state: string; position: AgentPosition }[];
  readonly sites: readonly { id: string; completedWork: number; damage: number; destroyed: boolean }[];
  readonly closedEdges: readonly string[];
}

const COORDINATOR_ID = AgentId.parse("coordinator");
const BRIEFING_ID = AgentId.parse("briefing");
const CHECKPOINT_EVERY_STEPS = 100;
const END_ORDER: readonly EndReason[] = [
  "all_protection_crews_lost",
  "all_sites_resolved",
  "fire_extinguished",
  "time_expired",
];

interface SensorMemory {
  /** Last published burn state + 1 per grid cell; 0 means never published. */
  cells: Uint8Array;
  sites: Map<SiteId, string>;
}

/** One running incident: truth world, knowledge stores, input queue and event log. */
export class Incident {
  readonly id: IncidentId;
  readonly scenario: SimScenario;
  readonly seed: string;
  readonly overrides: PrivateOverrides;
  readonly coordinator = new KnowledgeStore(COORDINATOR_ID);
  readonly agentStores = new Map<AgentId, KnowledgeStore>();
  readonly checkpoints: { timeMs: number; hash: string }[] = [];
  private readonly world: World;
  private readonly sensors = new Map<AgentId, SensorMemory>();
  private readonly queue: SimInput[] = [];
  private readonly applied: AppliedInput[] = [];
  private readonly events: DomainEvent[] = [];
  private readonly truthNotices: SimNotice[] = [];
  private readonly reports: CoordinatorView["recentReports"] = [];
  private activeRecipient: AgentId | null = null;
  private readonly sensorFaultUntil = new Map<AgentId, number>();
  private ordinal = 0;
  private wallMs = 0;
  private inputsClosed = false;
  private endRecord: IncidentEnd | null = null;
  private eventSequence = 0;
  private stepCount = 0;

  constructor(options: IncidentOptions) {
    this.scenario = SimScenario.parse(options.scenario);
    const problems = validateScenario(this.scenario);
    if (problems.length > 0) throw new Error(`invalid scenario: ${problems.join("; ")}`);
    this.seed = options.seed;
    this.overrides = options.overrides ?? {};
    this.id = IncidentId.parse(options.incidentId ?? `incident-${this.seed}`);
    this.world = new World(this.scenario, derivePrivateParameters(this.seed, this.overrides));
    for (const agent of this.world.agents) {
      this.agentStores.set(agent.id, new KnowledgeStore(agent.id));
      this.sensors.set(agent.id, {
        cells: new Uint8Array(SIM_DEFAULTS.gridSize * SIM_DEFAULTS.gridSize),
        sites: new Map(),
      });
    }
    this.publishBriefing();
    for (const agent of this.world.agents) this.sample(agent.id, 0);
  }

  get simTimeMs(): number {
    return this.world.timeMs;
  }

  get ended(): boolean {
    return this.endRecord !== null;
  }

  get end(): IncidentEnd | null {
    return this.endRecord;
  }

  get wallElapsedMs(): number {
    return this.wallMs;
  }

  /** Real elapsed play time, from a monotonic reading. Closes input at the play limit. */
  setWallElapsed(wallElapsedMs: number): void {
    if (wallElapsedMs > this.wallMs) this.wallMs = wallElapsedMs;
    if (this.wallMs >= SIM_DEFAULTS.realPlayLimitMs) this.inputsClosed = true;
  }

  get inputLog(): readonly AppliedInput[] {
    return this.applied;
  }

  get notices(): readonly SimNotice[] {
    return this.truthNotices;
  }

  agentRevision(agentId: AgentId): number {
    return this.mustStore(agentId).revision;
  }

  // ---------- inputs ----------

  submit(raw: SimInput): InputReceipt {
    if (this.ended) return { accepted: false, status: "incident_ended", ordinal: null };
    if (this.inputsClosed) return { accepted: false, status: "input_closed", ordinal: null };
    const input = SimInput.parse(raw);
    this.queue.push(input);
    return { accepted: true, status: "queued", ordinal: this.ordinal + this.queue.length - 1 };
  }

  private drainInputs(appliedAtMs: number): void {
    // Plans were built on the knowledge the agent had before this step, so they are applied before
    // anything that changes that knowledge (a relay) lands in the same step. Stable otherwise.
    const pending = this.queue.splice(0, this.queue.length).sort((a, b) => (a.kind === "commit_plan" ? 0 : 1) - (b.kind === "commit_plan" ? 0 : 1));
    for (const input of pending) {
      this.applied.push({ appliedAtMs, ordinal: this.ordinal, input });
      this.ordinal += 1;
      this.applyInput(input, appliedAtMs);
    }
  }

  private applyInput(input: SimInput, appliedAtMs: number): void {
    switch (input.kind) {
      case "commit_plan": {
        const store = this.agentStores.get(input.agentId);
        if (store === undefined) return;
        if (input.plan.knowledgeRevision !== store.revision) {
          this.world.notices.push({
            tick: this.world.timeMs,
            kind: "plan_rejected",
            agentId: input.agentId,
            reason: "stale_knowledge",
          });
          return;
        }
        this.world.commit(input.agentId, input.plan, input.workSiteId, input.mode);
        return;
      }
      case "report":
        this.reports.push(
          CoordinatorReportEntry.parse({
            sequence: SequenceNumber.parse(this.reports.length),
            simTimeMs: SimTimeMs.parse(appliedAtMs),
            agentId: input.agentId,
            text: input.text,
            urgent: input.urgent,
          }),
        );
        return;
      case "relay": {
        const store = this.agentStores.get(input.toAgentId);
        const source = this.coordinator.observations().find((o) => o.id === input.observationId);
        const target = this.world.agents.find((a) => a.id === input.toAgentId);
        if (store === undefined || source === undefined || target === undefined || target.state === "lost") return;
        store.ingestRelay(source, SimTimeMs.parse(appliedAtMs));
        return;
      }
      case "sensor_fault":
        this.sensorFaultUntil.set(input.agentId, input.untilMs);
        return;
      case "set_active_recipient":
        this.activeRecipient = input.recipientId;
        return;
    }
  }

  // ---------- stepping ----------

  /** Run authoritative steps until simulated time reaches dueMs or the incident ends. */
  advanceTo(dueMs: number): DomainEvent[] {
    const emittedFrom = this.events.length;
    const limit = Math.min(dueMs, SIM_DEFAULTS.incidentHorizonMs);
    while (!this.ended && this.world.timeMs + SIM_DEFAULTS.stepMs <= limit) this.stepOnce();
    return this.events.slice(emittedFrom);
  }

  private stepOnce(): void {
    const to = this.world.timeMs + SIM_DEFAULTS.stepMs;
    this.drainInputs(to);
    this.world.step();
    this.truthNotices.push(...this.world.notices.splice(0, this.world.notices.length));
    for (const agent of this.world.agents) {
      if (agent.state !== "lost") this.sample(agent.id, to);
    }
    this.stepCount += 1;
    if (this.stepCount % CHECKPOINT_EVERY_STEPS === 0) {
      this.checkpoints.push({ timeMs: to, hash: this.snapshotHash() });
    }
    this.evaluateEnd();
  }

  private evaluateEnd(): void {
    const w = this.world;
    const matching: EndReason[] = [];
    if (w.livingCrews().length === 0) matching.push("all_protection_crews_lost");
    if (w.sites.length > 0 && w.sites.every((s) => w.siteResolved(s))) matching.push("all_sites_resolved");
    if (w.fire.burningCount === 0) matching.push("fire_extinguished");
    if (w.timeMs >= SIM_DEFAULTS.incidentHorizonMs) matching.push("time_expired");
    if (matching.length === 0) return;
    const ordered = END_ORDER.filter((r) => matching.includes(r));
    const displayReason = ordered[0];
    if (displayReason === undefined) return;
    this.endRecord = IncidentEnd.parse({
      tick: w.timeMs,
      wallElapsedMs: this.wallMs,
      matchingReasons: ordered,
      displayReason,
      finalSnapshotHash: this.snapshotHash(),
    });
    this.events.push({ kind: "incident_end", payload: this.endRecord });
    this.eventSequence += 1;
    this.queue.length = 0;
    this.world.interruptCommitments();
    this.truthNotices.push(...this.world.notices.splice(0, this.world.notices.length));
  }

  // ---------- observation ----------

  private publishBriefing(): void {
    const sites = this.world.sites.map((s) => ({
      kind: "site" as const,
      siteId: s.id,
      completedWork: 0,
      damage: 0,
      destroyed: false,
    }));
    const cells = this.scenario.map.initialFireCells.map((gridCellIndex) => ({
      kind: "cell" as const,
      gridCellIndex,
      burnState: "burning" as const,
    }));
    const observation = Observation.parse({
      id: "obs:briefing",
      sourceAgentId: BRIEFING_ID,
      observedAt: 0,
      receivedAt: 0,
      spatialFootprint: { centerX: 800, centerY: 800, radius: 1200 },
      observedFields: [...cells, ...sites],
    });
    this.coordinator.ingest(observation);
    for (const store of this.agentStores.values()) store.ingest(observation);
  }

  private sample(agentId: AgentId, atMs: number): void {
    const agent = this.world.agent(agentId);
    const memory = this.sensors.get(agentId);
    if (memory === undefined) return;
    // A faulted sensor publishes nothing; its memory is untouched so recovery re-reports changes.
    if (atMs < (this.sensorFaultUntil.get(agentId) ?? 0)) return;
    const p = this.world.agentPoint(agent);
    const radius = SIM_DEFAULTS.observationRadiusM;
    const fields: Observation["observedFields"] = [];
    for (const cell of cellsWithin(p.x, p.y, radius)) {
      const state = this.world.burnStateAt(cell);
      const code = state === "unburned" ? 1 : state === "burning" ? 2 : 3;
      if (memory.cells[cell] === code) continue;
      memory.cells[cell] = code;
      fields.push({ kind: "cell", gridCellIndex: cell, burnState: state });
    }
    for (const site of this.world.sites) {
      const sp = this.world.road.nodePoint(site.nodeId);
      if (Math.hypot(sp.x - p.x, sp.y - p.y) > radius) continue;
      const key = `${site.completedWork}:${site.damage}:${site.destroyed}`;
      if (memory.sites.get(site.id) === key) continue;
      memory.sites.set(site.id, key);
      fields.push({
        kind: "site",
        siteId: site.id,
        completedWork: WorkUnits.parse(site.completedWork),
        damage: site.damage,
        destroyed: site.destroyed,
      });
    }
    if (fields.length === 0) return;
    const observation = Observation.parse({
      id: `obs:${agentId}:${atMs}`,
      sourceAgentId: agentId,
      observedAt: atMs,
      receivedAt: atMs,
      spatialFootprint: { centerX: p.x, centerY: p.y, radius },
      observedFields: fields,
    });
    this.mustStore(agentId).ingest(observation);
    this.coordinator.ingest(observation);
    this.events.push({ kind: "observation", payload: observation });
    this.eventSequence += 1;
  }

  private mustStore(agentId: AgentId): KnowledgeStore {
    const store = this.agentStores.get(agentId);
    if (store === undefined) throw new Error(`unknown agent ${agentId}`);
    return store;
  }

  // ---------- projections ----------

  projectCoordinator(options: { coordinatorForecast?: CoordinatorForecastView | null } = {}): CoordinatorView {
    const now = this.world.timeMs;
    const agentPlans: CoordinatorAgentPlanView[] = [];
    for (const agent of this.world.agents) {
      const c = agent.commitment;
      if (c === null || agent.state === "lost") continue;
      let phase: CoordinatorAgentPlanView["phase"] = "approach";
      if (agent.working) phase = "work";
      else if (c.hasWork && now >= c.plan.workInterval.endMs && c.legIndex >= c.approachCount) phase = "return";
      else if (!c.hasWork && c.legIndex >= c.plan.timedLegs.length - 1 && now >= c.plan.workInterval.startMs) phase = "return";
      agentPlans.push({
        agentId: agent.id,
        planId: c.plan.id,
        legs: c.plan.timedLegs.map((leg) => ({ edgeId: leg.edgeId, direction: leg.direction })),
        workInterval: c.plan.workInterval,
        refugeId: c.plan.refugeId,
        phase,
        limitingReason: c.plan.limitingReason,
      });
    }
    const view = {
      protocolVersion: WIRE_PROTOCOL_VERSION,
      // Rises with every authoritative step as well as every event, so a client that orders views by
      // sequence never discards a newer snapshot while agents hold and nothing is being observed.
      sequence: this.eventSequence + this.stepCount,
      simTimeMs: now,
      wallElapsedMs: this.wallMs,
      incidentStatus: this.ended ? "ended" : "active",
      activeRecipientId: this.activeRecipient,
      agents: this.world.agents.map((a) => ({
        id: a.id,
        role: a.role,
        callsign: a.callsign,
        position: this.world.toAgentPosition(a),
        state: a.state,
        reportedAt: now,
      })),
      sites: this.world.sites.map((s) => {
        const belief = this.coordinator.siteBelief(s.id);
        return {
          id: s.id,
          name: s.name,
          nodeId: s.nodeId,
          value: s.value,
          observedCompletedWork: belief?.completedWork ?? null,
          observedDamage: belief?.damage ?? null,
          observedDestroyed: belief?.destroyed ?? null,
          lastObservedAt: belief?.observedAt ?? null,
          stale: belief === undefined ? true : now - belief.observedAt > STALE_AFTER_MS,
        };
      }),
      observedCells: this.coordinator.cellBeliefs().map((b) => ({
        gridCellIndex: b.cell,
        burnState: b.state,
        lastObservedAt: b.observedAt,
        stale: now - b.observedAt > STALE_AFTER_MS,
        observerAgentId: b.sourceAgentId,
      })),
      agentPlans,
      coordinatorForecast: options.coordinatorForecast ?? null,
      recentReports: this.reports.slice(-20),
      incidentEnd: this.endRecord,
    };
    return CoordinatorView.parse(view);
  }

  /** What one agent may know: its own state and its own knowledge store, nothing else. */
  projectAgent(agentId: AgentId): AgentProjection {
    const agent = this.world.agent(agentId);
    const store = this.mustStore(agentId);
    const c = agent.commitment;
    return {
      agentId,
      simTimeMs: this.world.timeMs,
      role: agent.role,
      callsign: agent.callsign,
      position: this.world.toAgentPosition(agent),
      state: agent.state,
      objectiveRevision: agent.objectiveRevision,
      planRevision: agent.planRevision,
      knowledgeRevision: store.revision,
      commitment:
        c === null
          ? null
          : {
              planId: c.plan.id,
              legIndex: c.legIndex,
              legCount: c.plan.timedLegs.length,
              mode: c.mode,
              working: agent.working,
            },
      knowledge: store.snapshot(SimTimeMs.parse(this.world.timeMs)),
      inputHash: store.inputHash(),
    };
  }

  // ---------- truth (replay, tests and the server's private side only) ----------

  truth(): TruthSnapshot {
    return {
      timeMs: this.world.timeMs,
      cellState: this.world.fire.state.slice(),
      cellIgnitedAtMs: this.world.fire.ignitedAtMs.slice(),
      agents: this.world.agents.map((a) => ({ id: a.id, state: a.state, position: this.world.toAgentPosition(a) })),
      sites: this.world.sites.map((s) => ({
        id: s.id,
        completedWork: s.completedWork,
        damage: s.damage,
        destroyed: s.destroyed,
      })),
      closedEdges: [...this.world.closedEdges].sort(),
    };
  }

  /** Hash of the full authoritative state; wall time and knowledge are excluded. */
  snapshotHash(): string {
    const w = this.world;
    return hashValue({
      t: w.timeMs,
      cells: Array.from(w.fire.state).join(""),
      ign: Array.from(w.fire.ignitedAtMs).map((v) => (Number.isFinite(v) ? v : -1)),
      agents: w.agents.map((a) => [a.id, a.state, a.pos, a.commitment?.legIndex ?? -1, a.lostAtMs]),
      sites: w.sites.map((s) => [s.id, s.completedWork, s.damage, s.destroyed]),
    });
  }
}
