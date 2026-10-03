// Build the frozen OSM scenario from the packaged Overpass extract.
//   pnpm --filter @ember/simulation build && node packages/simulation/scripts/osm-to-scenario.mjs
// Reads data/osm-montclair-roads.json, tries 1.6 km crops of it (docs/SIMULATION.md: shift the crop rather
// than invent roads), keeps real road geometry, and picks the authored layer (refuges, sites, scouting points,
// the single-capacity segment, ignition) so the crop passes the documented geometry gates. Deterministic: the
// same extract always yields the same scenario. Writes data/scenario-osm-montclair-v1.json plus provenance.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { FireField, RoadIndex, SIM_DEFAULTS, cellCenter, cellIndexOf, createTerrain, refugeCells } from "../dist/model/index.js";
import { SimScenario, scenarioGates, scenarioHash, validateScenario } from "../dist/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const dataDir = join(here, "..", "data");
const SIZE = SIM_DEFAULTS.gridSize * SIM_DEFAULTS.cellMeters; // 1600 m
const SPEED = SIM_DEFAULTS.agentSpeedMps;
const raw = JSON.parse(readFileSync(join(dataDir, "osm-montclair-roads.json"), "utf8"));

// ---- projection: local meters, x east, y north, origin at the extract's south-west corner ----
const LAT0 = 37.8305;
const LON0 = -122.2115;
const MY = 110_574;
const MX = 111_320 * Math.cos((LAT0 * Math.PI) / 180);
const osmNodes = new Map();
for (const e of raw.elements) if (e.type === "node") osmNodes.set(e.id, { x: (e.lon - LON0) * MX, y: (e.lat - LAT0) * MY });
// Driveway-class service roads are left out of the skeleton: a crew network needs through roads, not driveways.
const ways = raw.elements.filter((e) => e.type === "way" && e.tags?.highway !== "service");

// ---- graph of a crop ----
function buildGraph(x0, y0) {
  const inside = (id) => {
    const p = osmNodes.get(id);
    if (p === undefined) return false;
    const x = p.x - x0;
    const y = p.y - y0;
    return x >= 5 && y >= 5 && x <= SIZE - 5 && y <= SIZE - 5;
  };
  const adj = new Map(); // nodeId -> Map(neighborId -> wayId)
  const link = (a, b, w) => {
    if (a === b) return;
    if (!adj.has(a)) adj.set(a, new Map());
    if (!adj.has(b)) adj.set(b, new Map());
    adj.get(a).set(b, w);
    adj.get(b).set(a, w);
  };
  for (const w of ways) for (let i = 1; i < w.nodes.length; i++) if (inside(w.nodes[i - 1]) && inside(w.nodes[i])) link(w.nodes[i - 1], w.nodes[i], w.id);

  // Keep the largest connected component.
  const comp = new Map();
  let best = [];
  for (const start of adj.keys()) {
    if (comp.has(start)) continue;
    const members = [];
    const stack = [start];
    comp.set(start, start);
    while (stack.length > 0) {
      const n = stack.pop();
      members.push(n);
      for (const m of adj.get(n).keys()) if (!comp.has(m)) (comp.set(m, start), stack.push(m));
    }
    if (members.length > best.length) best = members;
  }
  const keep = new Set(best);
  for (const n of [...adj.keys()]) if (!keep.has(n)) adj.delete(n);

  // Contract degree-2 nodes into polylines between junctions/ends.
  const isJunction = (n) => adj.get(n).size !== 2;
  const pt = (n) => {
    const p = osmNodes.get(n);
    return { x: p.x - x0, y: p.y - y0 };
  };
  const edges = [];
  const seenEdge = new Set();
  const junctions = [...adj.keys()].filter(isJunction);
  const walkFrom = (start, first) => {
    const path = [start, first];
    let prev = start;
    let cur = first;
    const ways_ = new Set([adj.get(start).get(first)]);
    while (!isJunction(cur)) {
      const [a, b] = [...adj.get(cur).keys()];
      const next = a === prev ? b : a;
      ways_.add(adj.get(cur).get(next));
      path.push(next);
      prev = cur;
      cur = next;
      if (cur === start) break;
    }
    return { path, ways: [...ways_] };
  };
  for (const j of junctions) {
    for (const nb of adj.get(j).keys()) {
      const { path, ways: wayIds } = walkFrom(j, nb);
      const end = path[path.length - 1];
      const key = path.length === 2 ? [j, end].sort().join(":") : `${[j, end].sort().join(":")}:${path.slice(1, -1).sort((a, b) => a - b)[0]}`;
      if (end === j || seenEdge.has(key)) continue;
      seenEdge.add(key);
      let length = 0;
      for (let i = 1; i < path.length; i++) length += Math.hypot(pt(path[i]).x - pt(path[i - 1]).x, pt(path[i]).y - pt(path[i - 1]).y);
      edges.push({ from: j, to: end, path, length, ways: wayIds });
    }
  }
  return { edges, pt, junctions };
}

// Remove short dead-end spurs (and the junctions they leave behind) so the graph is the road skeleton.
function prune(g) {
  let edges = g.edges;
  for (;;) {
    const deg = new Map();
    for (const e of edges) for (const n of [e.from, e.to]) deg.set(n, (deg.get(n) ?? 0) + 1);
    const drop = edges.filter((e) => (deg.get(e.from) === 1 || deg.get(e.to) === 1) && e.length < 90);
    if (drop.length === 0) break;
    const gone = new Set(drop);
    edges = edges.filter((e) => !gone.has(e));
  }
  // A node left with exactly two edges is no longer a junction: merge its edges.
  for (;;) {
    const at = new Map();
    for (const e of edges) for (const n of [e.from, e.to]) (at.get(n) ?? at.set(n, []).get(n)).push(e);
    const target = [...at.entries()].find(([, list]) => list.length === 2 && list[0] !== list[1] && !(list[0].from === list[0].to));
    if (target === undefined) break;
    const [n, [a, b]] = target;
    const orient = (e, startAt) => (e.from === startAt ? e : { ...e, from: e.to, to: e.from, path: [...e.path].reverse() });
    const left = orient(a, n); // n -> ...
    const right = orient(b, n); // n -> ...
    const merged = {
      from: left.to,
      to: right.to,
      path: [...[...left.path].reverse(), ...right.path.slice(1)],
      length: a.length + b.length,
      ways: [...new Set([...a.ways, ...b.ways])],
    };
    if (merged.from === merged.to) {
      edges = edges.filter((e) => e !== a && e !== b);
    } else {
      edges = edges.filter((e) => e !== a && e !== b).concat(merged);
    }
  }
  return { ...g, edges };
}

// ---- shortest paths ----
function dijkstra(adjList, src, banEdge = null) {
  const dist = new Map([[src, 0]]);
  const open = [src];
  while (open.length > 0) {
    open.sort((a, b) => dist.get(a) - dist.get(b));
    const n = open.shift();
    for (const { to, edge, length } of adjList.get(n) ?? []) {
      if (edge === banEdge) continue;
      const d = dist.get(n) + length;
      if (d < (dist.get(to) ?? Infinity)) (dist.set(to, d), open.push(to));
    }
  }
  return dist;
}
function adjacency(edges) {
  const adjList = new Map();
  for (const e of edges) {
    for (const [a, b] of [[e.from, e.to], [e.to, e.from]]) {
      if (!adjList.has(a)) adjList.set(a, []);
      adjList.get(a).push({ to: b, edge: e, length: e.length });
    }
  }
  return adjList;
}

// ---- scenario assembly for one crop; returns null if no valid layout is found ----
const SITE_DEFS = [
  ["site-a", "Ridge Cabins", 300, 1],
  ["site-b", "Waterworks", 450, 1.5],
  ["site-c", "Community Lodge", 600, 2],
];

const failures = new Map();
const fail = (why) => (failures.set(why, (failures.get(why) ?? 0) + 1), null);

function assemble(x0, y0, g) {
  const { edges, pt } = g;
  if (edges.length < 12 || edges.length > 220) return fail(`graph size ${edges.length < 12 ? "<12" : ">220"} edges`);
  const adjList = adjacency(edges);
  const nodes = [...adjList.keys()];
  const degree = (n) => adjList.get(n).length;
  const dists = new Map(nodes.map((n) => [n, dijkstra(adjList, n)]));
  const d = (a, b) => dists.get(a).get(b) ?? Infinity;

  // Refuges: entrances near the west and south edges, far apart, on the main road network.
  const near = (n, f) => f(pt(n));
  const westish = nodes.filter((n) => near(n, (p) => p.x < 450) && degree(n) >= 2).sort((a, b) => pt(a).x - pt(b).x);
  const southish = nodes.filter((n) => near(n, (p) => p.y < 450) && degree(n) >= 2).sort((a, b) => pt(a).y - pt(b).y);
  if (westish.length === 0 || southish.length === 0) return fail("no west/south refuge candidate");
  const refugeCandidates = [];
  for (const w of westish.slice(0, 6)) for (const s of southish.slice(0, 6)) if (w !== s && d(w, s) < Infinity && d(w, s) > 500) refugeCandidates.push([w, s]);

  let bestLayout = null;
  for (const [rw, rs] of refugeCandidates) {
    // Sites: nodes whose route from each refuge is 640-1360 m, spread apart, preferring dead ends and spurs.
    const siteCandidates = nodes.filter(
      (n) => n !== rw && n !== rs && [rw, rs].every((r) => d(r, n) >= 560 && d(r, n) <= 1500),
    );
    if (siteCandidates.length < 3) continue;
    siteCandidates.sort((a, b) => degree(a) - degree(b) || a - b);
    const picks = [];
    for (const c of siteCandidates) {
      if (picks.every((p) => Math.hypot(pt(p).x - pt(c).x, pt(p).y - pt(c).y) > 250)) picks.push(c);
      if (picks.length === 3) break;
    }
    if (picks.length < 3) continue;
    // Constrained segment: a mid-length edge with through nodes at both ends, on a refuge->site best route.
    let corridor = null;
    for (const e of edges) {
      if (e.length < 120 || e.length > 600 || degree(e.from) < 2 || degree(e.to) < 2) continue;
      const onRoute = picks.filter((s) => [rw, rs].some((r) => Math.abs(d(r, e.from) + e.length + d(e.to, s) - d(r, s)) < 1 || Math.abs(d(r, e.to) + e.length + d(e.from, s) - d(r, s)) < 1));
      if (onRoute.length >= 2 && (corridor === null || onRoute.length > corridor.hits || (onRoute.length === corridor.hits && e.length > corridor.edge.length))) {
        corridor = { edge: e, hits: onRoute.length };
      }
    }
    if (corridor === null) continue;
    // Scouting points: three nodes with pairwise disjoint 150 m observation discs, favoring the corridor ends.
    const scoutPool = [corridor.edge.from, corridor.edge.to, ...nodes].filter((n) => ![rw, rs].includes(n));
    const scouts = [];
    for (const c of scoutPool) {
      if (scouts.every((s) => Math.hypot(pt(s).x - pt(c).x, pt(s).y - pt(c).y) > 330) && !scouts.includes(c)) scouts.push(c);
      if (scouts.length === 3) break;
    }
    if (scouts.length < 3) continue;
    const score = picks.reduce((acc, s) => acc + Math.min(d(rw, s), d(rs, s)), 0) + corridor.hits * 1000;
    if (bestLayout === null || score > bestLayout.score) bestLayout = { rw, rs, picks, corridor: corridor.edge, scouts, score };
  }
  if (bestLayout === null) return fail(refugeCandidates.length === 0 ? "no refuge pair" : "no site/corridor/scout layout");
  return { ...bestLayout, edges, pt, adjList };
}

// ---- fire ignition: a 2x2 patch in the upwind (west) half that is >=200 m from agents and sites ----
function chooseFire(layout, scenarioBase) {
  const road = new RoadIndex(scenarioBase.map);
  const protectedCells = refugeCells(road, SIM_DEFAULTS.refugeRadiusM);
  const anchors = [layout.rw, layout.rs, ...layout.picks].map((n) => layout.pt(n));
  const terrain = createTerrain(scenarioBase.map.terrainSeed);
  let best = null;
  for (let gy = 4; gy < 60; gy += 4) {
    for (let gx = 2; gx < 34; gx += 4) {
      const cells = [gy * 64 + gx, gy * 64 + gx + 1, (gy + 1) * 64 + gx, (gy + 1) * 64 + gx + 1];
      if (cells.some((c) => protectedCells.has(c))) continue;
      if (cells.some((c) => anchors.some((a) => Math.hypot(cellCenter(c).x - a.x, cellCenter(c).y - a.y) < 220))) continue;
      // Interesting: at ordinary spread the fire should close the constrained corridor mid-incident.
      const field = new FireField(terrain, protectedCells);
      field.ignite(cells, 0);
      const p = { spreadMultiplier: 1, initialWindRad: 0, windShiftMs: 450_000, postShiftWindRad: 1.2 };
      let closedAt = Infinity;
      const corridorCells = new Set(road.mustEdge(layout.corridorId).cells.map((c) => c.cell));
      for (let t = 1000; t <= 900_000 && closedAt === Infinity; t += 1000) {
        field.step(t, 1000, p);
        for (const c of corridorCells) if (field.state[c] === 2) closedAt = t;
      }
      if (closedAt === Infinity) continue;
      const score = -Math.abs(closedAt - 500_000);
      if (best === null || score > best.score) best = { cells, closedAt, score };
    }
  }
  return best;
}

// ---- search over crops ----
// Crops must lie inside the box that was queried: Overpass also returns the far ends of roads that cross the
// box edge, so anything outside it is incomplete and would not be a faithful map.
const BOX = { south: 37.8205, west: -122.224, north: 37.8405, east: -122.199 };
const minX = (BOX.west - LON0) * MX;
const maxX = (BOX.east - LON0) * MX;
const minY = (BOX.south - LAT0) * MY;
const maxY = (BOX.north - LAT0) * MY;
console.log(`queried box spans ${Math.round(maxX - minX)} x ${Math.round(maxY - minY)} m; ${ways.length} ways, ${osmNodes.size} nodes`);

const results = [];
for (let x0 = Math.ceil(minX); x0 + SIZE <= maxX; x0 += 50) {
  for (let y0 = Math.ceil(minY); y0 + SIZE <= maxY; y0 += 50) {
    const g = prune(buildGraph(x0, y0));
    if (g.edges.length === 0) continue;
    const layout = assemble(x0, y0, g);
    if (layout === null) continue;
    // Materialize the candidate scenario.
    const nodeIds = new Map();
    const usedNodes = new Set();
    for (const e of layout.edges) (usedNodes.add(e.from), usedNodes.add(e.to));
    for (const n of usedNodes) nodeIds.set(n, `n-${n}`);
    const edgeList = layout.edges.map((e, i) => ({
      id: `e-${e.from}-${e.to}${layout.edges.slice(0, i).some((o) => o.from === e.from && o.to === e.to) ? `-${i}` : ""}`,
      from: nodeIds.get(e.from),
      to: nodeIds.get(e.to),
      via: e.path.slice(1, -1).map((n) => ({ x: Math.round(layout.pt(n).x * 10) / 10, y: Math.round(layout.pt(n).y * 10) / 10 })),
      singleCapacity: e === layout.corridor,
      _src: e,
    }));
    const corridorEdge = edgeList.find((e) => e._src === layout.corridor);
    const base = {
      version: "osm-montclair-v1",
      map: {
        nodes: [...usedNodes].map((n) => ({ id: nodeIds.get(n), x: Math.round(layout.pt(n).x * 10) / 10, y: Math.round(layout.pt(n).y * 10) / 10 })),
        edges: edgeList.map(({ _src, ...e }) => e),
        sites: SITE_DEFS.map(([id, name, requiredWork, value], i) => ({ id, name, nodeId: nodeIds.get(layout.picks[i]), requiredWork, value })),
        refuges: [
          { id: "refuge-west", name: "Refuge West", nodeId: nodeIds.get(layout.rw) },
          { id: "refuge-south", name: "Refuge South", nodeId: nodeIds.get(layout.rs) },
        ],
        scoutPoints: layout.scouts.map((n) => nodeIds.get(n)),
        terrainSeed: "osm-montclair-terrain",
        initialFireCells: [0],
      },
      agents: [
        { id: "crew-1", role: "protection_crew", callsign: "Crew 1", startNodeId: nodeIds.get(layout.rw) },
        { id: "crew-2", role: "protection_crew", callsign: "Crew 2", startNodeId: nodeIds.get(layout.rw) },
        { id: "crew-3", role: "protection_crew", callsign: "Crew 3", startNodeId: nodeIds.get(layout.rs) },
        { id: "scout", role: "scout", callsign: "Scout", startNodeId: nodeIds.get(layout.rs) },
      ],
      briefing:
        "Montclair hills incident. Road geometry is from OpenStreetMap (© OpenStreetMap contributors, ODbL); terrain, fuel, sites, refuges, the single-capacity segment and the ignition are authored.",
    };
    layout.corridorId = corridorEdge.id;
    // Cheap pre-check: the four geometry gates that do not depend on ignition must already pass.
    const probe = SimScenario.parse({ ...base, map: { ...base.map, initialFireCells: [cellIndexOf(800, 800)] } });
    if (validateScenario(probe).length > 0) continue;
    if (scenarioGates(probe).filter((x) => x.gate !== "ignition clearance").some((x) => !x.ok)) continue;
    const fire = chooseFire(layout, probe);
    if (fire === null) continue;
    const scenario = SimScenario.parse({ ...base, map: { ...base.map, initialFireCells: fire.cells } });
    if (validateScenario(scenario).length > 0) continue;
    const gates = scenarioGates(scenario);
    const passed = gates.filter((x) => x.ok).length;
    const median = Number(/median one-way (\d+)/.exec(gates.find((x) => x.gate === "travel time")?.detail ?? "")?.[1] ?? 0);
    const wayMap = Object.fromEntries(edgeList.map((e) => [e.id, e._src.ways]));
    results.push({ x0, y0, scenario, gates, passed, median, closedAt: fire.closedAt, edges: scenario.map.edges.length, wayMap });
  }
}
// All gates first; then prefer a travel time in the middle of its 150-350 s window; then a mid-incident closure.
results.sort((a, b) => b.passed - a.passed || Math.abs(a.median - 250) - Math.abs(b.median - 250) || Math.abs(a.closedAt - 500_000) - Math.abs(b.closedAt - 500_000));
console.log("layout failures:", Object.fromEntries(failures));
console.log(`${results.length} crops produced a candidate layout; best gate counts:`, results.slice(0, 5).map((r) => `${r.passed}/5 @(${r.x0},${r.y0}) ${r.edges} edges`).join(" | "));
const winner = results.find((r) => r.passed === 5);
if (winner === undefined) {
  console.log("no crop passed all gates; closest:");
  for (const g of results[0]?.gates ?? []) console.log(`  ${g.ok ? "ok  " : "FAIL"} ${g.gate}: ${g.detail}`);
  process.exit(1);
}
const frozen = JSON.parse(JSON.stringify(winner.scenario));
writeFileSync(join(dataDir, "scenario-osm-montclair-v1.json"), `${JSON.stringify(frozen)}\n`);
writeFileSync(
  join(dataDir, "scenario-osm-montclair-v1.provenance.json"),
  `${JSON.stringify(
    {
      source: "OpenStreetMap via the Overpass API (overpass-api.de)",
      license: "ODbL 1.0 — © OpenStreetMap contributors, https://www.openstreetmap.org/copyright",
      extractFile: "osm-montclair-roads.json",
      extractQuery: readFileSync(join(dataDir, "osm-montclair-roads.query.txt"), "utf8").trim(),
      extractDataTimestamp: raw.osm3s.timestamp_osm_base,
      projection: { origin: { lat: LAT0, lon: LON0 }, note: "local equirectangular meters; crop origin below is the crop's south-west corner in these coordinates" },
      cropOrigin: { x: winner.x0, y: winner.y0, sizeM: SIZE },
      scenarioHash: scenarioHash(winner.scenario),
      nodeIdFormat: "n-<OSM node id>; edge ids are e-<from OSM node>-<to OSM node>",
      authored: ["terrain height and fuel (seeded)", "site, refuge and scouting-point selection", "single-capacity segment", "initial ignition patch"],
      osmWaysByEdge: winner.wayMap,
      omitted: ["highway=service (driveway) ways", "pedestrian and cycle ways, which the query excluded", "road segments with an end outside the crop"],
    },
    null,
    2,
  )}\n`,
);
// The scenario also ships as a TypeScript module so tests and the server can load it without file access.
writeFileSync(
  join(here, "..", "src", "osm-montclair-scenario.generated.ts"),
  `// Generated by scripts/osm-to-scenario.mjs from data/scenario-osm-montclair-v1.json. Do not edit by hand.\nexport const osmMontclairScenarioJson = ${JSON.stringify(frozen)} as const;\n`,
);
console.log(`\nfrozen crop at (${winner.x0}, ${winner.y0}); fire closes the corridor at ${winner.closedAt / 1000} s at ordinary spread`);
for (const g of winner.gates) console.log(`  ok   ${g.gate}: ${g.detail}`);
console.log(`scenario hash ${scenarioHash(winner.scenario)}; nodes ${winner.scenario.map.nodes.length}, edges ${winner.scenario.map.edges.length}`);
