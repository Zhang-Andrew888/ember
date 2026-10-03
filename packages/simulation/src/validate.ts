import { RoadIndex, SIM_DEFAULTS, cellCenter, cellIndexOf, cellsWithin, refugeCells } from "./model/index.js";
import type { SimScenario } from "./scenario.js";

function coordinateError(label: string, x: number, y: number): string | null {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return `${label} has non-finite coordinates`;
  if (cellIndexOf(x, y) === null) return `${label} is off the grid`;
  return null;
}

function polylineLength(points: readonly { x: number; y: number }[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    total += Math.hypot(b.x - a.x, b.y - a.y);
  }
  return total;
}

/** Referential and structural checks a scenario file must pass before it can start an incident. */
export function validateScenario(scenario: SimScenario): string[] {
  const errors: string[] = [];
  const m = scenario.map;
  const nodeIds = new Set<string>(m.nodes.map((n) => n.id));
  const nodesById = new Map(m.nodes.map((n) => [n.id, n]));
  const dup = (label: string, ids: readonly string[]): void => {
    if (new Set(ids).size !== ids.length) errors.push(`duplicate ${label} ids`);
  };
  dup("node", m.nodes.map((n) => n.id));
  dup("edge", m.edges.map((e) => e.id));
  dup("site", m.sites.map((s) => s.id));
  dup("agent", scenario.agents.map((a) => a.id));
  for (const e of m.edges) {
    if (!nodeIds.has(e.from)) errors.push(`edge ${e.id} starts at unknown node ${e.from}`);
    if (!nodeIds.has(e.to)) errors.push(`edge ${e.id} ends at unknown node ${e.to}`);
  }
  for (const s of m.sites) if (!nodeIds.has(s.nodeId)) errors.push(`site ${s.id} is on unknown node ${s.nodeId}`);
  for (const r of m.refuges) if (!nodeIds.has(r.nodeId)) errors.push(`refuge ${r.id} is on unknown node ${r.nodeId}`);
  for (const p of m.scoutPoints) if (!nodeIds.has(p)) errors.push(`scouting point ${p} is not a node`);
  for (const a of scenario.agents) if (!nodeIds.has(a.startNodeId)) errors.push(`agent ${a.id} starts at unknown node ${a.startNodeId}`);
  if (m.refuges.length === 0) errors.push("no refuge");
  if (m.initialFireCells.length === 0) errors.push("no initial fire");
  for (const c of m.initialFireCells) {
    if (c < 0 || c >= SIM_DEFAULTS.gridSize ** 2) errors.push(`initial fire cell ${c} is off the grid`);
  }
  for (const n of m.nodes) {
    const problem = coordinateError(`node ${n.id}`, n.x, n.y);
    if (problem !== null) errors.push(problem);
  }
  for (const e of m.edges) {
    for (let i = 0; i < e.via.length; i++) {
      const p = e.via[i]!;
      const problem = coordinateError(`edge ${e.id} via point ${i}`, p.x, p.y);
      if (problem !== null) errors.push(problem);
    }
    const a = nodesById.get(e.from);
    const b = nodesById.get(e.to);
    if (a === undefined || b === undefined) continue;
    const points = [{ x: a.x, y: a.y }, ...e.via, { x: b.x, y: b.y }];
    if (!points.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))) continue;
    if (!(polylineLength(points) > 0)) errors.push(`edge ${e.id} has invalid geometry`);
  }
  if (errors.length > 0) return errors;

  const road = new RoadIndex(m);
  const protectedCells = refugeCells(road, SIM_DEFAULTS.refugeRadiusM);
  for (const c of m.initialFireCells) if (protectedCells.has(c)) errors.push(`initial fire cell ${c} is inside a refuge area`);
  // Every node must be reachable from a refuge, otherwise something can never be reached or left.
  const seen = new Set<string>();
  const stack = m.refuges.map((r) => r.nodeId as string);
  while (stack.length > 0) {
    const n = stack.pop()!;
    if (seen.has(n)) continue;
    seen.add(n);
    for (const adj of road.adjacency.get(n as never) ?? []) stack.push(adj.toNode);
  }
  for (const n of nodeIds) if (!seen.has(n)) errors.push(`node ${n} is not connected to a refuge`);
  return errors;
}

export interface GateResult {
  readonly gate: string;
  readonly ok: boolean;
  readonly detail: string;
}

function shortest(road: RoadIndex, from: string, banEdge: string | null): Map<string, number> {
  const dist = new Map<string, number>([[from, 0]]);
  const open = [from];
  while (open.length > 0) {
    open.sort((a, b) => dist.get(a)! - dist.get(b)!);
    const n = open.shift()!;
    for (const adj of road.adjacency.get(n as never) ?? []) {
      if (adj.edgeId === banEdge) continue;
      const d = dist.get(n)! + road.mustEdge(adj.edgeId).length;
      if (d < (dist.get(adj.toNode) ?? Infinity)) {
        dist.set(adj.toNode, d);
        open.push(adj.toNode);
      }
    }
  }
  return dist;
}

/**
 * The scenario geometry acceptance constraints from docs/SIMULATION.md as executable checks, so a
 * real map crop can be tested against the same gates as the synthetic fixture.
 */
export function scenarioGates(scenario: SimScenario): GateResult[] {
  const road = new RoadIndex(scenario.map);
  const speed = SIM_DEFAULTS.agentSpeedMps;
  const gates: GateResult[] = [];

  // Ignition at least 200 m from every agent start and site, outside refuge areas.
  const anchors = [...scenario.agents.map((a) => road.nodePoint(a.startNodeId)), ...scenario.map.sites.map((s) => road.nodePoint(s.nodeId))];
  const protectedCells = refugeCells(road, SIM_DEFAULTS.refugeRadiusM);
  let nearest = Infinity;
  for (const c of scenario.map.initialFireCells) {
    const p = cellCenter(c);
    for (const a of anchors) nearest = Math.min(nearest, Math.hypot(p.x - a.x, p.y - a.y));
  }
  const inRefuge = scenario.map.initialFireCells.some((c) => protectedCells.has(c));
  gates.push({ gate: "ignition clearance", ok: nearest >= 200 && !inRefuge, detail: `nearest agent or site ${Math.round(nearest)} m; in refuge area: ${inRefuge}` });

  // Typical one-way refuge-to-site travel 150-350 simulated seconds (median over pairs).
  const times: number[] = [];
  for (const r of scenario.map.refuges) {
    const d = shortest(road, r.nodeId, null);
    for (const s of scenario.map.sites) times.push((d.get(s.nodeId) ?? Infinity) / speed);
  }
  times.sort((a, b) => a - b);
  const median = times[Math.floor(times.length / 2)] ?? Infinity;
  gates.push({ gate: "travel time", ok: median >= 150 && median <= 350, detail: `median one-way ${Math.round(median)} s` });

  // Two meaningful approaches: losing one road of the best route leaves a route at least 20% longer.
  let bestRatio = 0;
  for (const r of scenario.map.refuges) {
    for (const s of scenario.map.sites) {
      const base = shortest(road, r.nodeId, null).get(s.nodeId);
      if (base === undefined) continue;
      for (const edge of road.edges.values()) {
        const alt = shortest(road, r.nodeId, edge.id).get(s.nodeId);
        if (alt !== undefined && alt > base * 1.0001) bestRatio = Math.max(bestRatio, alt / base);
      }
    }
  }
  gates.push({ gate: "alternative approach", ok: bestRatio >= 1.2, detail: `longest alternative is ${bestRatio.toFixed(2)}x the best route` });

  // A constrained segment with waiting space (a through node) at both ends.
  const constrained = [...road.edges.values()].filter((e) => e.singleCapacity);
  const waits = constrained.filter((e) => (road.adjacency.get(e.from)?.length ?? 0) >= 2 && (road.adjacency.get(e.to)?.length ?? 0) >= 2);
  gates.push({ gate: "constrained segment", ok: waits.length > 0, detail: `${constrained.length} single-capacity, ${waits.length} with waiting nodes at both ends` });

  // At least two scouting points reveal different parts of the road network.
  const coverage = scenario.map.scoutPoints.map((p) => {
    const pt = road.nodePoint(p);
    const disc = new Set(cellsWithin(pt.x, pt.y, SIM_DEFAULTS.observationRadiusM));
    const cells = new Set<number>();
    for (const e of road.edges.values()) for (const c of e.cells) if (disc.has(c.cell)) cells.add(c.cell);
    return cells;
  });
  let distinct = false;
  for (let i = 0; i < coverage.length; i++) {
    for (let j = i + 1; j < coverage.length; j++) {
      const a = coverage[i]!;
      const b = coverage[j]!;
      if (a.size > 0 && b.size > 0 && [...a].every((c) => !b.has(c))) distinct = true;
    }
  }
  gates.push({ gate: "scouting points", ok: distinct, detail: `${coverage.length} points; two with disjoint road coverage: ${distinct}` });
  return gates;
}
