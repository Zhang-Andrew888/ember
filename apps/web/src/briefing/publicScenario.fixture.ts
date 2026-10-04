import { PublicScenarioBriefing } from "@ember/domain";

/**
 * A `GET /scenario` body shaped like the server's synthetic scenario (same node names, sites and
 * refuges as the bundled snapshot) so briefing tests can exercise the live path without a server.
 */
export const publicScenario: PublicScenarioBriefing = PublicScenarioBriefing.parse({
  version: "synthetic-v1",
  gridSize: 64,
  cellMeters: 25,
  nodes: [
    { id: "n-rw", x: 100, y: 800 },
    { id: "n-rs", x: 800, y: 100 },
    { id: "n-j1", x: 400, y: 800 },
    { id: "n-s", x: 700, y: 600 },
    { id: "n-h", x: 1000, y: 800 },
    { id: "n-n", x: 500, y: 1200 },
    { id: "n-sa", x: 1200, y: 1050 },
    { id: "n-sb", x: 1250, y: 800 },
    { id: "n-sc", x: 1200, y: 550 },
  ],
  edges: [
    { id: "e-rw-j1", from: "n-rw", to: "n-j1" },
    { id: "e-j1-s", from: "n-j1", to: "n-s" },
    { id: "e-s-h", from: "n-s", to: "n-h", singleCapacity: true },
    { id: "e-j1-n", from: "n-j1", to: "n-n" },
    { id: "e-n-h", from: "n-n", to: "n-h" },
    { id: "e-rs-s", from: "n-rs", to: "n-s" },
    { id: "e-h-sa", from: "n-h", to: "n-sa" },
    { id: "e-h-sb", from: "n-h", to: "n-sb" },
    { id: "e-h-sc", from: "n-h", to: "n-sc" },
    { id: "e-rs-sc", from: "n-rs", to: "n-sc", via: [{ x: 1000, y: 250 }] },
  ],
  sites: [
    { id: "site-a", name: "Ridge Cabins", nodeId: "n-sa", value: 1 },
    { id: "site-b", name: "Waterworks", nodeId: "n-sb", value: 1.5 },
    { id: "site-c", name: "Community Lodge", nodeId: "n-sc", value: 2 },
  ],
  refuges: [
    { id: "refuge-west", name: "Refuge West", nodeId: "n-rw" },
    { id: "refuge-south", name: "Refuge South", nodeId: "n-rs" },
  ],
  agents: [
    { callsign: "Crew 1", role: "protection_crew" },
    { callsign: "Crew 2", role: "protection_crew" },
    { callsign: "Crew 3", role: "protection_crew" },
    { callsign: "Scout", role: "scout" },
  ],
  // The 2x2 ignition patch around (230..255, 1100..1125) m: rows 44, columns 9..10 on a 64-grid.
  initialFireCells: [44 * 64 + 9, 44 * 64 + 10, 45 * 64 + 9, 45 * 64 + 10],
});
