import { describe, expect, it } from "vitest";
import { agentMapLabelMeta, agentMapLabelText, siteMapLabelMeta, siteMapLabelText } from "./mapLabels.js";
import type { AgentMarker, SiteMarker } from "./sceneEntities.js";

const agent: AgentMarker = {
  id: "crew-1",
  callsign: "Crew 1",
  role: "protection_crew",
  state: "idle",
  position: { x: 0, z: 0 },
  heading: null,
  ageMs: 45_000,
};

const site: SiteMarker = {
  id: "site-a",
  name: "Ridge Cabins",
  position: { x: 0, z: 0 },
  protectionStatus: "unprotected",
  damage: 0.2,
  stale: true,
  ageMs: 45_000,
};

describe("mapLabels", () => {
  it("agent map labels omit last-seen phrasing", () => {
    expect(agentMapLabelText(agent)).toBe("Crew 1 · idle");
    expect(agentMapLabelText(agent)).not.toMatch(/last seen/i);
  });

  it("site map labels omit last-seen phrasing", () => {
    const text = siteMapLabelText(site);
    expect(text).toContain("Ridge Cabins: no protection completed");
    expect(text).not.toMatch(/last seen/i);
  });

  it("stale map labels expose exact timing only in the title tooltip", () => {
    const meta = agentMapLabelMeta(agent, 90_000);
    expect(meta.stale).toBe(true);
    expect(meta.title).toMatch(/Last observed at 0:45/);
    expect(meta.title).toMatch(/last seen/i);
  });

  it("fresh sites carry no stale title", () => {
    const meta = siteMapLabelMeta({ ...site, ageMs: 5_000, stale: false }, 90_000);
    expect(meta.stale).toBe(false);
    expect(meta.title).toBeUndefined();
  });
});
