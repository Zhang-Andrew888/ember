import type { AgentId } from "@ember/domain";
import { RoadIndex, type PublicMap } from "@ember/simulation/model";
import type { IncidentSession } from "./session.js";

export const POLICY_NAME = "scripted-relay";
export const POLICY_VERSION = "2";
const PERIOD_MS = 5000;

export interface RelayLogEntry {
  readonly tick: number;
  readonly observationId: string;
  readonly toAgentId: string;
}

/**
 * The deterministic scripted coordinator used for every comparison run. It sees only the
 * coordinator projection (what the coordinator has received) plus the public map. Every five
 * simulated seconds it may relay at most one newest unrelayed observation (fire or clear) touching an
 * agent's last reported route and site, preferring agents that are withdrawing, then stable agent id.
 * Each delivery uses the same addressed-relay path as a human message; it never reads truth or
 * invents facts, and it logs every relay.
 */
export class ScriptedCoordinatorPolicy {
  readonly log: RelayLogEntry[] = [];
  private readonly road: RoadIndex;
  private readonly relayed = new Map<string, Set<string>>();
  private nextAt = PERIOD_MS;
  private readonly delayMs: number;
  private readonly dropEvery: number;
  private dropCounter = 0;
  private readonly queued: { atMs: number; observationId: string; toAgentId: string }[] = [];

  /** `delayMs` and `dropEvery` inject relay-path failures for robustness runs. */
  constructor(
    private readonly session: IncidentSession,
    map: PublicMap,
    options: { delayMs?: number; dropEvery?: number } = {},
  ) {
    this.road = new RoadIndex(map);
    this.delayMs = options.delayMs ?? 0;
    this.dropEvery = options.dropEvery ?? 0;
  }

  /** Call once per simulated second after the session step. */
  tick(): void {
    const inc = this.session.incident;
    const now = inc.simTimeMs;
    for (const q of [...this.queued]) {
      if (q.atMs <= now) {
        this.queued.splice(this.queued.indexOf(q), 1);
        this.deliver(q.observationId, q.toAgentId, now);
      }
    }
    if (inc.ended || now < this.nextAt) return;
    this.nextAt = now + PERIOD_MS;
    const view = inc.projectCoordinator();
    const agents = [...view.agents]
      .filter((a) => a.state !== "lost" && a.role === "protection_crew")
      .sort((a, b) => {
        const wa = a.state === "withdrawing" || a.state === "retreating" ? 0 : 1;
        const wb = b.state === "withdrawing" || b.state === "retreating" ? 0 : 1;
        return wa - wb || (a.id < b.id ? -1 : 1);
      });
    // Anything the coordinator received that touches an agent's route is relevant: a sighting of
    // fire, and equally a recent sighting that a road is still unburned (old ones are history).
    const received = inc.coordinator.observations().filter((o) => o.sourceAgentId !== "briefing");
    for (const agent of agents) {
      const routeCells = this.routeCells(agent.id, view);
      if (routeCells.size === 0) continue;
      const done = this.relayed.get(agent.id) ?? new Set<string>();
      const candidates = received
        .filter((o) => o.sourceAgentId !== agent.id && !done.has(o.id))
        .filter((o) => o.observedFields.some((f) => f.kind === "cell" && routeCells.has(f.gridCellIndex)))
        .sort((a, b) => b.observedAt - a.observedAt || (a.id < b.id ? -1 : 1));
      const pick = candidates[0];
      if (pick === undefined) continue;
      done.add(pick.id);
      this.relayed.set(agent.id, done);
      this.dropCounter += 1;
      if (this.dropEvery > 0 && this.dropCounter % this.dropEvery === 0) return; // injected loss
      if (this.delayMs > 0) this.queued.push({ atMs: now + this.delayMs, observationId: pick.id, toAgentId: agent.id });
      else this.deliver(pick.id, agent.id, now);
      return;
    }
  }

  private deliver(observationId: string, toAgentId: string, now: number): void {
    this.session.relay(observationId, toAgentId);
    this.log.push({ tick: now, observationId, toAgentId });
  }

  /** Grid cells on the public shortest path from the agent's reported position to its reported site and home. */
  private routeCells(agentId: AgentId, view: ReturnType<IncidentSession["incident"]["projectCoordinator"]>): Set<number> {
    const agent = view.agents.find((a) => a.id === agentId);
    if (agent === undefined) return new Set();
    const siteId = this.reportedSite(agentId);
    const cells = new Set<number>();
    const startNodes = agent.position.kind === "node" ? [agent.position.nodeId as string] : this.endpoints(agent.position.edgeId);
    const targets: string[] = [];
    if (siteId !== null) {
      const site = this.road.map.sites.find((s) => s.id === siteId);
      if (site !== undefined) targets.push(site.nodeId);
    }
    for (const r of this.road.map.refuges) targets.push(r.nodeId);
    for (const t of targets) {
      for (const s of startNodes) for (const edgeId of this.shortestPath(s, t)) for (const c of this.road.mustEdge(edgeId as never).cells) cells.add(c.cell);
    }
    if (agent.position.kind === "edge") for (const c of this.road.mustEdge(agent.position.edgeId).cells) cells.add(c.cell);
    return cells;
  }

  private endpoints(edgeId: string): string[] {
    const e = this.road.mustEdge(edgeId as never);
    return [e.from, e.to];
  }

  private reportedSite(agentId: AgentId): string | null {
    const reports = this.session.decisions.filter((d) => d.event.agentId === agentId && (d.event.type === "mission_start" || d.event.type === "mission_update"));
    const last = reports[reports.length - 1];
    if (last === undefined) return null;
    const text = last.event.actualAction.toLowerCase();
    return this.road.map.sites.find((s) => text.includes(s.name.toLowerCase()))?.id ?? null;
  }

  private shortestPath(from: string, to: string): string[] {
    const dist = new Map<string, number>([[from, 0]]);
    const prev = new Map<string, { node: string; edge: string }>();
    const open = [from];
    while (open.length > 0) {
      open.sort((a, b) => dist.get(a)! - dist.get(b)!);
      const n = open.shift()!;
      if (n === to) break;
      for (const adj of this.road.adjacency.get(n as never) ?? []) {
        const d = dist.get(n)! + this.road.mustEdge(adj.edgeId).length;
        if (d < (dist.get(adj.toNode) ?? Infinity)) {
          dist.set(adj.toNode, d);
          prev.set(adj.toNode, { node: n, edge: adj.edgeId });
          open.push(adj.toNode);
        }
      }
    }
    const out: string[] = [];
    let cur = to;
    while (cur !== from) {
      const p = prev.get(cur);
      if (p === undefined) return [];
      out.push(p.edge);
      cur = p.node;
    }
    return out;
  }
}
