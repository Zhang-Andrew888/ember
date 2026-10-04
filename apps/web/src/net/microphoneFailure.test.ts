import { describe, expect, it } from "vitest";
import { microphoneStartFailureMessage } from "./microphoneFailure.js";

function named(name: string): Error {
  const error = new Error("x");
  error.name = name;
  return error;
}

describe("microphoneStartFailureMessage", () => {
  it("explains denied permission", () => {
    expect(microphoneStartFailureMessage(named("NotAllowedError"))).toMatch(/denied/);
  });

  it("explains a missing microphone", () => {
    expect(microphoneStartFailureMessage(named("NotFoundError"))).toMatch(/No microphone/);
  });

  it("explains a busy microphone", () => {
    expect(microphoneStartFailureMessage(named("NotReadableError"))).toMatch(/in use/);
  });

  it("falls back for unknown failures and always offers text", () => {
    for (const error of [named("Weird"), "oops", null]) {
      expect(microphoneStartFailureMessage(error)).toMatch(/type your message/);
    }
  });
});
