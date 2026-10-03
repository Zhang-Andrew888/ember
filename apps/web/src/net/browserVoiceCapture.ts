export interface BrowserVoiceCapture {
  start(): Promise<void>;
  stop(): Promise<Blob | null>;
  cancel(): void;
}

/** Records one push-to-talk utterance with MediaRecorder (requires mic permission). */
export function createBrowserVoiceCapture(): BrowserVoiceCapture {
  let stream: MediaStream | null = null;
  let recorder: MediaRecorder | null = null;
  const chunks: Blob[] = [];

  return {
    async start() {
      if (recorder?.state === "recording") return;
      chunks.length = 0;
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      recorder = new MediaRecorder(stream);
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunks.push(event.data);
      };
      recorder.start();
    },
    async stop() {
      if (recorder === null || recorder.state !== "recording") {
        for (const track of stream?.getTracks() ?? []) track.stop();
        stream = null;
        recorder = null;
        chunks.length = 0;
        return null;
      }
      const active = recorder;
      const done = new Promise<void>((resolve) => {
        active.onstop = () => resolve();
      });
      active.stop();
      await done;
      for (const track of stream?.getTracks() ?? []) track.stop();
      stream = null;
      recorder = null;
      if (chunks.length === 0) return null;
      return new Blob(chunks, { type: active.mimeType || "audio/webm" });
    },
    cancel() {
      if (recorder?.state === "recording") recorder.stop();
      for (const track of stream?.getTracks() ?? []) track.stop();
      stream = null;
      recorder = null;
      chunks.length = 0;
    },
  };
}
