import { describe, expect, it } from "vitest";
import { devServerProxyTarget } from "./vite.config.js";

describe("devServerProxyTarget", () => {
  it("defaults to 127.0.0.1:3000", () => {
    expect(devServerProxyTarget({})).toBe("http://127.0.0.1:3000");
  });

  it("reads EMBER_SERVER_PORT", () => {
    expect(devServerProxyTarget({ EMBER_SERVER_PORT: "4000" })).toBe("http://127.0.0.1:4000");
  });

  it("rejects invalid ports", () => {
    expect(() => devServerProxyTarget({ EMBER_SERVER_PORT: "0" })).toThrow(/EMBER_SERVER_PORT/);
  });
});
