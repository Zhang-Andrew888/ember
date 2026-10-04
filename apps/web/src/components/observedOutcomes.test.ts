import { describe, expect, it } from "vitest";
import { CoordinatorView } from "@ember/domain";
import { fixtureCoordinatorView } from "../../../../tests/fixtures/coordinator-view.fixture.js";
import { observedOutcomes } from "./observedOutcomes.js";

const view = CoordinatorView.parse(fixtureCoordinatorView);

describe("observedOutcomes", () => {
  it("lists every site, highest value first, and every crew", () => {
    const outcomes = observedOutcomes(view);
    expect(outcomes.sites).toHaveLength(view.sites.length);
    const values = outcomes.sites.map((site) => view.sites.find((candidate) => candidate.id === site.id)!.value);
    expect(values).toEqual([...values].sort((a, b) => b - a));
    expect(outcomes.crews.map((crew) => crew.callsign)).toEqual(view.agents.map((agent) => agent.callsign));
  });

  it("says when a site was never observed instead of guessing", () => {
    const unobserved: CoordinatorView = {
      ...view,
      sites: view.sites.map((site) => ({ ...site, lastObservedAt: null, observedDamage: null })),
    };
    for (const site of observedOutcomes(unobserved).sites) {
      expect(site.observedAt).toBe("never");
      expect(site.damage).toBe("not observed");
    }
  });
});
