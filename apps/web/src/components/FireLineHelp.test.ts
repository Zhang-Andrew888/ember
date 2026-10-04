import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ConversationPanel } from "./ConversationPanel.js";
import { FIRE_LINE_HELP_EXAMPLES, FireLineHelp } from "./FireLineHelp.js";

const noop = () => {};

describe("components/FireLineHelp", () => {
  const html = renderToStaticMarkup(createElement(FireLineHelp));

  it("has the heading and the two plan 2.4 example orders", () => {
    expect(html).toContain("How to order a fire line");
    expect(FIRE_LINE_HELP_EXAMPLES).toHaveLength(2);
    expect(html).toContain("Crew 1, cut line from Waterworks to Ridge Cabins.");
    expect(html).toContain("Crew 1 on the south end, Crew 2 on the north end.");
    expect(html.match(/<li>/g)).toHaveLength(2);
  });

  it("reminds that directions follow the on-screen compass, north at the bottom at the start", () => {
    expect(html).toContain("Directions follow the on-screen compass");
    expect(html).toContain("north is at the bottom of the screen");
  });

  it("is plain text: no colour-coded status, no inline colour", () => {
    expect(html).not.toMatch(/style=|color/i);
  });

  it("sits in the conversation panel by the message box", () => {
    const panel = renderToStaticMarkup(
      createElement(ConversationPanel, {
        transcript: [],
        activeRecipientCallsign: null,
        onSendMessage: noop,
        onPttBegin: noop,
        onPttRelease: noop,
        onPttCancel: noop,
        composerDisabled: false,
        demoMode: true,
        speechSnapshot: { state: "idle", text: null, urgent: false, queuedUrgent: false, queuedRoutineCount: 0 },
      }),
    );
    expect(panel).toContain("How to order a fire line");
    expect(panel.indexOf("How to order a fire line")).toBeLessThan(panel.indexOf('id="composer-input"'));
  });
});
