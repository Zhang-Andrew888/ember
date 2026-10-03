import { describe, expect, it } from "vitest";
import { EdgeId, SimTimeMs } from "@ember/domain";
import { enumerateApproachRoutes, routeIdOf } from "./approach-routes.js";

describe("enumerateApproachRoutes", () => {
  it("finds a second route when the first path is banned edge-by-edge", () => {
    const primary = ["e-a", "e-b", "e-c"];
    const alternate = ["e-a", "e-x", "e-c"];
    const discover = (ban: ReadonlySet<EdgeId>) => {
      const pick = ban.has(EdgeId.parse("e-b")) ? alternate : primary;
      if (pick.some((e) => ban.has(EdgeId.parse(e)))) return null;
      const legs = pick.map((edgeId, i) => ({
        edgeId: EdgeId.parse(edgeId),
        direction: "forward" as const,
        departMs: SimTimeMs.parse(i * 5000),
        arriveMs: SimTimeMs.parse((i + 1) * 5000),
      }));
      return { legs, k: pick.length };
    };
    const routes = enumerateApproachRoutes(discover, new Set());
    expect(routes.map((r) => routeIdOf(r.legs))).toEqual([
      "e-a+>e-b+>e-c+",
      "e-a+>e-x+>e-c+",
    ]);
  });

  it("respects the max route cap", () => {
    let n = 0;
    const discover = () => {
      n += 1;
      const edge = EdgeId.parse(`e-${n}`);
      return {
        legs: [{ edgeId: edge, direction: "forward" as const, departMs: SimTimeMs.parse(0), arriveMs: SimTimeMs.parse(5000) }],
        k: 1,
      };
    };
    expect(enumerateApproachRoutes(discover, new Set(), 3)).toHaveLength(3);
  });
});
