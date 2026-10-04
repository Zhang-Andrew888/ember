import { describe, expect, it } from "vitest";
import { AgentId } from "@ember/domain";
import { agentBrigadeSlot, preferSiteWhenThreatened } from "./brigade.js";

describe("brigade deconfliction", () => {
  it("assigns different slots to crew-1 and crew-2", () => {
    const a = AgentId.parse("crew-1");
    const b = AgentId.parse("crew-2");
    expect(agentBrigadeSlot(a, 2)).not.toBe(agentBrigadeSlot(b, 2));
  });

  it("prefers site work when peers hold the fire line and sites are threatened", () => {
    const peer = new Set([100]);
    expect(preferSiteWhenThreatened(AgentId.parse("crew-1"), peer, 1, 2, 2)).toBe(true);
  });
});
