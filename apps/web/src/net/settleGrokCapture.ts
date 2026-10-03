export const GROK_CAPTURE_FAILURE_MESSAGE =
  "Transcription failed. Hold push-to-talk to try again.";

export type GrokCaptureStatus = "released" | "cancelled" | "failed";

/**
 * Finish one live push-to-talk capture.
 * A thrown stop or transcription calls `onCancel` exactly once so the server can end recording.
 * A transcript calls `onRelease` exactly once.
 */
export async function settleGrokCapture<Audio>(input: {
  readonly stop: () => Promise<Audio | null>;
  readonly transcribe: (audio: Audio) => Promise<string | null>;
  readonly onRelease: (text: string) => void;
  readonly onCancel: () => void;
}): Promise<{ readonly status: GrokCaptureStatus }> {
  let blob: Audio | null;
  try {
    blob = await input.stop();
  } catch {
    input.onCancel();
    return { status: "failed" };
  }
  if (blob === null) {
    input.onCancel();
    return { status: "cancelled" };
  }
  let text: string | null;
  try {
    text = await input.transcribe(blob);
  } catch {
    input.onCancel();
    return { status: "failed" };
  }
  if (text) {
    input.onRelease(text);
    return { status: "released" };
  }
  input.onCancel();
  return { status: "failed" };
}
