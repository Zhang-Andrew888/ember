import { describe, expect, it } from "vitest";
import { DecisionType, Objective } from "./index.js";

const base = {
  id: "obj-move",
  recipientId: "crew-1",
  kind: "move_direction",
  targetId: null,
  constraints: {},
  issueSequence: 1,
};

describe("directional movement objective", () => {
  it.each(["north", "northeast", "east", "southeast", "south", "southwest", "west", "northwest"])(
    "parses %s with a bounded default and explicit stop rule",
    (direction) => {
      const objective = Objective.parse({ ...base, movement: { direction } });
      expect(objective.movement).toEqual({ direction, maxDistanceMeters: 250, stopRule: "safe_road_node" });
      expect(Objective.parse(JSON.parse(JSON.stringify(objective)))).toEqual(objective);
    },
  );

  it("accepts case, spacing, and an explicit distance within the bound", () => {
    const objective = Objective.parse({
      ...base,
      movement: { direction: " North-East ", maxDistanceMeters: 400 },
    });
    expect(objective.movement?.direction).toBe("northeast");
    expect(objective.movement?.maxDistanceMeters).toBe(400);
  });

  it("requires an unambiguous compass direction and valid distance", () => {
    expect(Objective.safeParse({ ...base, movement: undefined }).success).toBe(false);
    expect(Objective.safeParse({ ...base, movement: { direction: "north or east" } }).success).toBe(false);
    expect(Objective.safeParse({ ...base, movement: { direction: "up" } }).success).toBe(false);
    expect(Objective.safeParse({ ...base, movement: { direction: "north", maxDistanceMeters: 0 } }).success).toBe(false);
    expect(Objective.safeParse({ ...base, movement: { direction: "north", maxDistanceMeters: 501 } }).success).toBe(false);
    expect(Objective.safeParse({ ...base, targetId: "site-a", movement: { direction: "north" } }).success).toBe(false);
  });

  it("keeps existing objectives valid and supports explicit refusal decisions", () => {
    expect(Objective.parse({ ...base, kind: "hold" }).kind).toBe("hold");
    expect(DecisionType.options).toContain("objective_rejected");
  });
});
