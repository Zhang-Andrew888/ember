import { describe, expect, it } from "vitest";
import { sceneDebugEnabled } from "./debugPanelGate.js";

describe("scene debug opt-in", () => {
  it.each(["", "?demo=1", "?debug=0", "?debug=true"])("is hidden for %s", (search) => {
    expect(sceneDebugEnabled(search)).toBe(false);
  });
  it("requires explicit debug=1", () => {
    expect(sceneDebugEnabled("?demo=1&debug=1")).toBe(true);
  });
});
