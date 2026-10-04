import type { AgentId, EdgeId, MissionPlan } from "@ember/domain";
import type { RoadIndex } from "@ember/simulation/model";
import type { ReservationOracle } from "./types.js";

/** Reservation priority, highest first: physical occupant, emergency, return, approach. */
export type PriorityClass = "emergency" | "return" | "approach";

const RANK: Record<PriorityClass, number> = { emergency: 1, return: 2, approach: 3 };

export interface Window {
  readonly edgeId: EdgeId;
  readonly direction: "forward" | "reverse";
  readonly enterMs: number;
  readonly exitMs: number;
}

export interface Holding {
  readonly agentId: AgentId;
  readonly planId: string;
  readonly windows: readonly Window[];
  readonly cls: PriorityClass;
  readonly requestedEntryMs: number;
}

export interface Occupant {
  readonly edgeId: EdgeId;
  readonly expectedExitMs: number;
}

export interface Conflict {
  readonly agentId: AgentId;
  readonly edgeId: EdgeId;
}

export type ReserveResult =
  | { readonly ok: true; readonly yielded: readonly { agentId: AgentId; revisedPlan: MissionPlan }[] }
  | {
      readonly ok: false;
      readonly reason: "physically_occupied" | "conflict" | "no_safe_yield";
      readonly conflicts: readonly Conflict[];
    };

/**
 * Asked of a holder that would have to give up a future slot. The holder verifies its own
 * revised complete mission (or emergency alternative) and returns it, or null if it cannot
 * yield safely. The service never reads the holder's fire forecast.
 */
export type YieldHandler = (holder: AgentId, blocked: readonly Window[], nowMs: number) => MissionPlan | null;

const DEFAULT_GUARD_MS = 5000;

/**
 * Timed occupancy reservations for single-capacity segments. Physical occupants always come
 * first and cannot be preempted; an unoccupied future slot moves only after its holder
 * verifies a safe yield. If nobody can yield, no schedule is invented.
 */
export class ReservationService {
  private readonly held = new Map<AgentId, Holding>();
  private readonly occupants = new Map<AgentId, Occupant>();
  private yieldHandler: YieldHandler | null = null;
  private rev = 0;

  constructor(
    private readonly road: RoadIndex,
    private readonly guardMs: number = DEFAULT_GUARD_MS,
  ) {}

  get revision(): number {
    return this.rev;
  }

  setYieldHandler(handler: YieldHandler | null): void {
    this.yieldHandler = handler;
  }

  /** Earlier requested entry first, then stable agent id, within the same class. */
  static outranks(
    a: { cls: PriorityClass; enterMs: number; agentId: AgentId },
    b: { cls: PriorityClass; enterMs: number; agentId: AgentId },
  ): boolean {
    if (RANK[a.cls] !== RANK[b.cls]) return RANK[a.cls] < RANK[b.cls];
    if (a.enterMs !== b.enterMs) return a.enterMs < b.enterMs;
    return a.agentId <= b.agentId;
  }

  windowsOfPlan(plan: MissionPlan): Window[] {
    const out: Window[] = [];
    for (const leg of plan.timedLegs) {
      if (!this.road.mustEdge(leg.edgeId).singleCapacity) continue;
      out.push({ edgeId: leg.edgeId, direction: leg.direction, enterMs: leg.departMs, exitMs: leg.arriveMs });
    }
    return out;
  }

  holdings(agentId: AgentId): Holding | null {
    return this.held.get(agentId) ?? null;
  }

  release(agentId: AgentId): void {
    if (this.held.delete(agentId)) this.rev += 1;
  }

  /** Where an agent physically is on a single-capacity segment, and when it will leave. */
  updateOccupancy(agentId: AgentId, occupant: Occupant | null): void {
    const prev = this.occupants.get(agentId);
    if (occupant === null) {
      if (this.occupants.delete(agentId)) this.rev += 1;
      return;
    }
    if (prev === undefined || prev.edgeId !== occupant.edgeId || prev.expectedExitMs !== occupant.expectedExitMs) {
      this.occupants.set(agentId, occupant);
      this.rev += 1;
    }
  }

  private overlaps(aEnter: number, aExit: number, bEnter: number, bExit: number): boolean {
    return aEnter < bExit + this.guardMs && bEnter < aExit + this.guardMs;
  }

  /**
   * What `agentId` may plan against. Reservations of equal or higher class (and anything already
   * begun or physically occupied) block; lower-class future holders do not, because they can be
   * asked to yield when this agent reserves.
   */
  oracleFor(agentId: AgentId, cls?: PriorityClass, nowMs = 0): ReservationOracle {
    return {
      isFree: (edgeId, _direction, enterMs, exitMs) => {
        if (!this.road.mustEdge(edgeId).singleCapacity) return true;
        for (const [other, occ] of this.occupants) {
          if (other === agentId || occ.edgeId !== edgeId) continue;
          if (this.overlaps(enterMs, exitMs, nowMs, occ.expectedExitMs)) return false;
        }
        for (const h of this.held.values()) {
          if (h.agentId === agentId) continue;
          for (const w of h.windows) {
            if (w.edgeId !== edgeId || !this.overlaps(enterMs, exitMs, w.enterMs, w.exitMs)) continue;
            const begun = w.enterMs <= nowMs;
            if (cls === undefined || begun || RANK[h.cls] <= RANK[cls]) return false;
          }
        }
        return true;
      },
    };
  }

  /** False when a physical occupant (e.g. a reversing agent) now overlaps this agent's future slots. */
  stillValid(agentId: AgentId, nowMs: number): boolean {
    const h = this.held.get(agentId);
    if (h === undefined) return true;
    for (const w of h.windows) {
      if (w.exitMs <= nowMs) continue;
      for (const [other, occ] of this.occupants) {
        if (other === agentId || occ.edgeId !== w.edgeId) continue;
        if (this.overlaps(w.enterMs, w.exitMs, nowMs, occ.expectedExitMs)) return false;
      }
    }
    return true;
  }

  /**
   * Reserve every single-capacity leg of `plan` for `agentId`, atomically replacing its earlier
   * reservations. Never preempts a physical occupant; yields only through the handler.
   */
  reserve(agentId: AgentId, plan: MissionPlan, cls: PriorityClass, nowMs: number): ReserveResult {
    const windows = this.windowsOfPlan(plan);
    const requestedEntryMs = windows[0]?.enterMs ?? nowMs;
    const mine = { cls, enterMs: requestedEntryMs, agentId };

    for (const w of windows) {
      for (const [other, occ] of this.occupants) {
        if (other === agentId || occ.edgeId !== w.edgeId) continue;
        if (this.overlaps(w.enterMs, w.exitMs, nowMs, occ.expectedExitMs)) {
          return { ok: false, reason: "physically_occupied", conflicts: [{ agentId: other, edgeId: w.edgeId }] };
        }
      }
    }

    const conflicts = new Map<AgentId, { holding: Holding; blocked: Window[] }>();
    for (const h of this.held.values()) {
      if (h.agentId === agentId) continue;
      for (const hw of h.windows) {
        for (const w of windows) {
          if (hw.edgeId !== w.edgeId || !this.overlaps(w.enterMs, w.exitMs, hw.enterMs, hw.exitMs)) continue;
          const entry = conflicts.get(h.agentId) ?? { holding: h, blocked: [] };
          entry.blocked.push(hw);
          conflicts.set(h.agentId, entry);
        }
      }
    }
    const commit = (): void => {
      this.held.set(agentId, { agentId, planId: plan.id, windows, cls, requestedEntryMs });
      this.rev += 1;
    };
    if (conflicts.size === 0) {
      commit();
      return { ok: true, yielded: [] };
    }
    const list = [...conflicts.values()];
    const conflictList: Conflict[] = list.flatMap((c) =>
      c.blocked.map((w) => ({ agentId: c.holding.agentId, edgeId: w.edgeId })),
    );
    // A holder whose slot has begun is occupying; it cannot be asked to move.
    if (list.some((c) => c.blocked.some((w) => w.enterMs <= nowMs))) {
      return { ok: false, reason: "physically_occupied", conflicts: conflictList };
    }
    const allMovable = list.every((c) =>
      ReservationService.outranks(mine, { cls: c.holding.cls, enterMs: c.holding.requestedEntryMs, agentId: c.holding.agentId }),
    );
    if (!allMovable) return { ok: false, reason: "conflict", conflicts: conflictList };
    if (this.yieldHandler === null) return { ok: false, reason: "no_safe_yield", conflicts: conflictList };

    const before = new Map(this.held);
    commit();
    const yielded: { agentId: AgentId; revisedPlan: MissionPlan }[] = [];
    for (const c of list) {
      const revised = this.yieldHandler(c.holding.agentId, c.blocked, nowMs);
      if (revised === null) {
        this.held.clear();
        for (const [k, v] of before) this.held.set(k, v);
        this.rev += 1;
        return { ok: false, reason: "no_safe_yield", conflicts: conflictList };
      }
      yielded.push({ agentId: c.holding.agentId, revisedPlan: revised });
    }
    for (const y of yielded) {
      const prev = before.get(y.agentId);
      this.held.set(y.agentId, {
        agentId: y.agentId,
        planId: y.revisedPlan.id,
        windows: this.windowsOfPlan(y.revisedPlan),
        cls: prev?.cls ?? "approach",
        requestedEntryMs: this.windowsOfPlan(y.revisedPlan)[0]?.enterMs ?? nowMs,
      });
    }
    this.rev += 1;
    return { ok: true, yielded };
  }
}
