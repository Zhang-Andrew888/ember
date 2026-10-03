export interface BrowserVoiceCapture {
  start(): Promise<void>;
  stop(): Promise<Blob | null>;
  cancel(): void;
}

type CapturePhase = "idle" | "acquiring" | "recording" | "closed";

function stopTracks(target: MediaStream | null): void {
  for (const track of target?.getTracks() ?? []) track.stop();
}

/**
 * Records one push-to-talk utterance with MediaRecorder (requires mic permission).
 * Acquisition and recording share one phase so stop/cancel during the permission
 * prompt never starts a recorder and always stops tracks that arrive later.
 */
export function createBrowserVoiceCapture(): BrowserVoiceCapture {
  let stream: MediaStream | null = null;
  let recorder: MediaRecorder | null = null;
  const chunks: Blob[] = [];
  let phase: CapturePhase = "idle";

  return {
    async start() {
      if (phase !== "idle") return;
      phase = "acquiring";
      chunks.length = 0;
      let acquired: MediaStream;
      try {
        acquired = await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch (error) {
        if (phase !== "acquiring") return;
        phase = "closed";
        throw error;
      }
      if (phase !== "acquiring") {
        stopTracks(acquired);
        return;
      }
      stream = acquired;
      recorder = new MediaRecorder(stream);
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunks.push(event.data);
      };
      recorder.start();
      phase = "recording";
    },
    async stop() {
      if (phase === "acquiring") {
        phase = "closed";
        stopTracks(stream);
        stream = null;
        recorder = null;
        chunks.length = 0;
        return null;
      }
      if (phase !== "recording") return null;
      const active = recorder;
      phase = "closed";
      if (active === null || active.state !== "recording") {
        stopTracks(stream);
        stream = null;
        recorder = null;
        chunks.length = 0;
        return null;
      }
      const done = new Promise<void>((resolve) => {
        active.onstop = () => resolve();
      });
      active.stop();
      await done;
      stopTracks(stream);
      stream = null;
      recorder = null;
      if (chunks.length === 0) return null;
      return new Blob(chunks, { type: active.mimeType || "audio/webm" });
    },
    cancel() {
      if (phase === "idle" || phase === "closed") return;
      const recording = phase === "recording" ? recorder : null;
      phase = "closed";
      if (recording?.state === "recording") recording.stop();
      stopTracks(stream);
      stream = null;
      recorder = null;
      chunks.length = 0;
    },
  };
}
