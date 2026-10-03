import { afterEach, describe, expect, it, vi } from "vitest";
import { createBrowserVoiceCapture } from "./browserVoiceCapture.js";

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve: (value: T) => void = () => {};
  let reject: (error: unknown) => void = () => {};
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("net/browserVoiceCapture", () => {
  let recorderStarts = 0;
  let tracksStopped = 0;

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function installMedia(getUserMedia: () => Promise<MediaStream>): void {
    recorderStarts = 0;
    tracksStopped = 0;
    class FakeRecorder {
      state: RecordingState = "inactive";
      mimeType = "audio/webm";
      ondataavailable: ((event: BlobEvent) => void) | null = null;
      onstop: (() => void) | null = null;

      constructor(_stream: MediaStream) {
        recorderStarts += 1;
      }

      start(): void {
        this.state = "recording";
        this.ondataavailable?.({ data: new Blob(["audio"], { type: "audio/webm" }) } as BlobEvent);
      }

      stop(): void {
        this.state = "inactive";
        this.onstop?.();
      }
    }

    vi.stubGlobal("MediaRecorder", FakeRecorder);
    vi.stubGlobal("navigator", {
      mediaDevices: { getUserMedia },
    });
  }

  function fakeStream(): MediaStream {
    const track = {
      stop() {
        tracksStopped += 1;
      },
    };
    return { getTracks: () => [track] } as unknown as MediaStream;
  }

  it("does not start a recorder when stop() happens before permission is granted", async () => {
    const pending = deferred<MediaStream>();
    installMedia(() => pending.promise);
    const capture = createBrowserVoiceCapture();
    const started = capture.start();

    const early = await capture.stop();
    expect(early).toBeNull();
    expect(recorderStarts).toBe(0);
    expect(tracksStopped).toBe(0);

    pending.resolve(fakeStream());
    await started;

    expect(recorderStarts).toBe(0);
    expect(tracksStopped).toBe(1);
  });

  it("does not start a recorder when cancel() happens before permission is granted", async () => {
    const pending = deferred<MediaStream>();
    installMedia(() => pending.promise);
    const capture = createBrowserVoiceCapture();
    const started = capture.start();

    capture.cancel();
    pending.resolve(fakeStream());
    await started;

    expect(recorderStarts).toBe(0);
    expect(tracksStopped).toBe(1);
  });

  it("resolves start() when permission is denied after cancel", async () => {
    const pending = deferred<MediaStream>();
    installMedia(() => pending.promise);
    const capture = createBrowserVoiceCapture();
    const started = capture.start();

    capture.cancel();
    pending.reject(new Error("denied"));
    await expect(started).resolves.toBeUndefined();
    expect(recorderStarts).toBe(0);
    expect(tracksStopped).toBe(0);
  });

  it("rejects start() when permission is denied while still acquiring", async () => {
    installMedia(() => Promise.reject(new Error("denied")));
    const capture = createBrowserVoiceCapture();
    await expect(capture.start()).rejects.toThrow("denied");
    expect(recorderStarts).toBe(0);
  });

  it("returns audio and stops tracks after a granted recording", async () => {
    installMedia(async () => fakeStream());
    const capture = createBrowserVoiceCapture();
    await capture.start();
    expect(recorderStarts).toBe(1);

    const blob = await capture.stop();
    expect(blob).not.toBeNull();
    expect(blob?.size).toBeGreaterThan(0);
    expect(blob?.type).toBe("audio/webm");
    expect(tracksStopped).toBe(1);
  });
});
