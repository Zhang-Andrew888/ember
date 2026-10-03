import { describe, expect, it, vi } from "vitest";
import { GROK_CAPTURE_FAILURE_MESSAGE, settleGrokCapture } from "./settleGrokCapture.js";

const audio = new Blob(["audio"], { type: "audio/webm" });

describe("settleGrokCapture", () => {
  it("cancels once when transcription rejects and does not release", async () => {
    const onRelease = vi.fn();
    const onCancel = vi.fn();
    const result = await settleGrokCapture({
      stop: () => Promise.resolve(audio),
      transcribe: () => Promise.reject(new Error("network down")),
      onRelease,
      onCancel,
    });
    expect(result).toEqual({ status: "failed" });
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onRelease).not.toHaveBeenCalled();
    expect(GROK_CAPTURE_FAILURE_MESSAGE).toContain("try again");
  });

  it("cancels once when capture stop rejects", async () => {
    const onRelease = vi.fn();
    const onCancel = vi.fn();
    const transcribe = vi.fn();
    const result = await settleGrokCapture({
      stop: () => Promise.reject(new Error("recorder failed")),
      transcribe,
      onRelease,
      onCancel,
    });
    expect(result).toEqual({ status: "failed" });
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onRelease).not.toHaveBeenCalled();
    expect(transcribe).not.toHaveBeenCalled();
  });

  it("cancels once when transcription returns no text", async () => {
    const onRelease = vi.fn();
    const onCancel = vi.fn();
    const result = await settleGrokCapture({
      stop: () => Promise.resolve(audio),
      transcribe: () => Promise.resolve(null),
      onRelease,
      onCancel,
    });
    expect(result).toEqual({ status: "failed" });
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onRelease).not.toHaveBeenCalled();
  });

  it("cancels without treating a missing recording as a transcription failure", async () => {
    const onRelease = vi.fn();
    const onCancel = vi.fn();
    const transcribe = vi.fn();
    const result = await settleGrokCapture({
      stop: () => Promise.resolve(null),
      transcribe,
      onRelease,
      onCancel,
    });
    expect(result).toEqual({ status: "cancelled" });
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onRelease).not.toHaveBeenCalled();
    expect(transcribe).not.toHaveBeenCalled();
  });

  it("releases once when transcription returns text", async () => {
    const onRelease = vi.fn();
    const onCancel = vi.fn();
    const result = await settleGrokCapture({
      stop: () => Promise.resolve(audio),
      transcribe: () => Promise.resolve("Crew 2, hold position"),
      onRelease,
      onCancel,
    });
    expect(result).toEqual({ status: "released" });
    expect(onRelease).toHaveBeenCalledTimes(1);
    expect(onRelease).toHaveBeenCalledWith("Crew 2, hold position");
    expect(onCancel).not.toHaveBeenCalled();
  });
});
