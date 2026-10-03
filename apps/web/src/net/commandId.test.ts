import { describe, expect, it } from "vitest";
import { newCommandId } from "./commandId.js";

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("newCommandId", () => {
  it("uses crypto.randomUUID when available", () => {
    expect(newCommandId({ randomUUID: () => "11111111-1111-4111-8111-111111111111" })).toBe("11111111-1111-4111-8111-111111111111");
  });

  it("falls back to a valid v4 UUID when randomUUID throws (insecure http context)", () => {
    const id = newCommandId({
      randomUUID: () => {
        throw new TypeError("randomUUID is not a function in insecure contexts");
      },
      getRandomValues: ((array: Uint8Array) => array.fill(7)) as Crypto["getRandomValues"],
    });
    expect(id).toMatch(UUID_V4);
  });

  it("falls back when randomUUID is missing entirely, and when crypto is missing", () => {
    expect(newCommandId({ getRandomValues: ((a: Uint8Array) => a.fill(255)) as Crypto["getRandomValues"] })).toMatch(UUID_V4);
    expect(newCommandId(undefined)).toMatch(UUID_V4);
  });

  it("produces distinct ids without any crypto", () => {
    const ids = new Set(Array.from({ length: 200 }, () => newCommandId(undefined)));
    expect(ids.size).toBe(200);
  });
});
