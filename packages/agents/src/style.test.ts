import { describe, expect, it } from "vitest";
import { explain } from "./explain.js";
import { applyStyle } from "./style.js";

describe("communication style", () => {
  it("plain leaves the text exactly as is", () => {
    expect(applyStyle("Crew 2", "Crew 2 is withdrawing. Waiting here is no longer safe.", "plain")).toBe("Crew 2 is withdrawing. Waiting here is no longer safe.");
  });

  it("radio goes callsign-first and shorter", () => {
    expect(applyStyle("Crew 2", "Crew 2 is withdrawing. A direct observation closed the planned route.", "radio")).toBe("Crew 2, withdrawing. A direct observation closed the planned route.");
    expect(applyStyle("Crew 2", "Crew 2 changed plan: returning to refuge.", "radio")).toBe("Crew 2, new plan: returning to refuge.");
    expect(applyStyle("Crew 2", "Crew 2 cannot do that and return with the required margin. (forecast_leg_unsafe)", "radio")).toMatch(/^Crew 2, cannot do that/);
  });

  it("radio puts the callsign first when the text lacks it, and never doubles it", () => {
    expect(applyStyle("Crew 2", "taking the west loop", "radio")).toBe("Crew 2, taking the west loop");
    expect(applyStyle("Crew 2", "Crew 2, holding.", "radio")).toBe("Crew 2, holding.");
  });

  it("never drops the reason or a statement of uncertainty", () => {
    for (const code of ["forecast_leg_unsafe", "forecast_unreliable", "no_known_passable_route", "route_closed_by_observation"]) {
      const plain = explain("Crew 2", { type: "withdrawal_triggered", reasonCode: code, actualAction: "" });
      const radio = applyStyle("Crew 2", plain, "radio");
      const reason = plain.split(". ").slice(1).join(". ");
      expect(radio.endsWith(reason)).toBe(true);
      expect(radio.startsWith("Crew 2,")).toBe(true);
      expect(radio.length).toBeLessThanOrEqual(plain.length);
    }
  });

  it("is deterministic", () => {
    const t = "Crew 2 is stranded. No known passable route to a refuge; observing and reporting.";
    expect(applyStyle("Crew 2", t, "radio")).toBe(applyStyle("Crew 2", t, "radio"));
  });
});
