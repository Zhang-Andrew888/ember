import { createElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { fixtureCoordinatorView as rawFixture } from "../../../../tests/fixtures/coordinator-view.fixture.js";
import { adaptToScenarioIds } from "../net/mockBase.js";
import { omitScoutFromView } from "../format/omitScout.js";
import { scenarioMap } from "../map/activeScenario.js";
import { buildSceneEntities } from "./scene/sceneEntities.js";
import { AgentRail } from "./AgentRail.js";

function buttons(node: ReactNode, found: ReactElement<{ onClick?: () => void }>[] = []): ReactElement<{ onClick?: () => void }>[] {
  if (Array.isArray(node)) node.forEach((child) => buttons(child, found));
  else if (isValidElement(node)) {
    const element = node as ReactElement<{ onClick?: () => void; children?: ReactNode }>;
    if (element.type === "button") found.push(element);
    buttons(element.props.children, found);
  }
  return found;
}

// The frozen fixture uses placeholder ids; the adapter maps it onto the real scenario.
const fixtureCoordinatorView = adaptToScenarioIds(rawFixture);

describe("issue #118 - agent rail and crew selection", () => {
  const crewOnly = omitScoutFromView(fixtureCoordinatorView);

  it("lists only crews for a new demo view and no Scout card", () => {
    const html = renderToStaticMarkup(
      createElement(AgentRail, { agents: crewOnly.agents, selectedAgentId: null, onSelectAgent: () => {} }),
    );
    expect(html).toContain("Crew 1");
    expect(html).toContain("Crew 2");
    expect(html.toLowerCase()).not.toContain("scout");
  });

  it("selecting a crew card calls onSelectAgent with that crew and marks it pressed", () => {
    const onSelectAgent = vi.fn();
    const tree = AgentRail({ agents: crewOnly.agents, selectedAgentId: "crew-2", onSelectAgent });
    const cards = buttons(tree);
    expect(cards).toHaveLength(crewOnly.agents.length);
    cards[0]!.props.onClick?.();
    expect(onSelectAgent).toHaveBeenCalledWith("crew-1");
    const html = renderToStaticMarkup(
      createElement(AgentRail, { agents: crewOnly.agents, selectedAgentId: "crew-2", onSelectAgent }),
    );
    expect(html).toMatch(/aria-pressed="true"[^>]*>\s*<span[^>]*>Crew 2/);
  });

  it("still renders an old view that carries a scout, with a neutral role label and no crash", () => {
    const html = renderToStaticMarkup(
      createElement(AgentRail, { agents: fixtureCoordinatorView.agents, selectedAgentId: "scout", onSelectAgent: () => {} }),
    );
    expect(html).toContain("Agent");
    expect(html).not.toContain("agent-rail__role\">Scout");
  });

  it("scene entities resolve crews for a new view and still resolve a view with a scout", () => {
    const fresh = buildSceneEntities(crewOnly, scenarioMap);
    expect(fresh.agents.map((agent) => agent.id).sort()).toEqual(["crew-1", "crew-2"]);
    expect(fresh.agents.every((agent) => agent.role === "protection_crew")).toBe(true);
    const old = buildSceneEntities(fixtureCoordinatorView, scenarioMap);
    expect(old.agents.map((agent) => agent.id).sort()).toEqual(["crew-1", "crew-2", "scout"]);
  });
});
