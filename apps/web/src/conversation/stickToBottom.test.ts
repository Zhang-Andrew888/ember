import { describe, expect, it } from "vitest";
import { isNearBottom } from "./stickToBottom.js";

describe("conversation/stickToBottom", () => {
  it("follows when already at the bottom or within the threshold", () => {
    expect(isNearBottom({ scrollTop: 992, clientHeight: 685, scrollHeight: 1677 })).toBe(true);
    expect(isNearBottom({ scrollTop: 960, clientHeight: 685, scrollHeight: 1677 })).toBe(true);
  });

  it("stops following once the reader has scrolled up (issue #44 starts at scrollTop 0)", () => {
    expect(isNearBottom({ scrollTop: 0, clientHeight: 685, scrollHeight: 1677 })).toBe(false);
    expect(isNearBottom({ scrollTop: 500, clientHeight: 685, scrollHeight: 1677 })).toBe(false);
  });

  it("follows a transcript that fits without scrolling", () => {
    expect(isNearBottom({ scrollTop: 0, clientHeight: 685, scrollHeight: 400 })).toBe(true);
  });
});
