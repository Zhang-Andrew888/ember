import { describe, expect, it } from "vitest";
import { CoordinatorView } from "@ember/domain";
import { fixtureCoordinatorView } from "../../../../tests/fixtures/coordinator-view.fixture.js";
import { describeCrew, describeWork } from "./crewDetails.js";

const view = CoordinatorView.parse(fixtureCoordinatorView);

describe("crewDetails", () => {
  it("summarises a crew from reported fields only", () => {
    const agent = view.agents.find((candidate) => candidate.id === "crew-1")!;
    const plan = view.agentPlans.find((candidate) => candidate.agentId === "crew-1");
    const details = describeCrew(agent, plan, view.sites, view.simTimeMs);
    expect(details.callsign).toBe("Crew 1");
    expect(details.stateLabel.length).toBeGreaterThan(0);
    expect(details.reported).toContain("incident time");
    expect(details.objective).toMatch(/^(Heading out for|Doing|Returning to refuge after) /);
  });

  it("has no objective when the crew has no reportable plan", () => {
    const agent = view.agents[0]!;
    expect(describeCrew(agent, undefined, view.sites, null).objective).toBeNull();
  });

  it("describes structure protection and fire suppression work", () => {
    const site = view.sites[0]!;
    expect(describeWork({ kind: "protect_structure", siteId: site.id }, view.sites)).toBe(`structure protection at ${site.name}`);
    expect(describeWork({ kind: "suppress_fire", gridCellIndex: 66 }, view.sites)).toBe("fire suppression at row 1, column 2");
    expect(describeWork(undefined, view.sites)).toBe("structure protection");
  });
});
