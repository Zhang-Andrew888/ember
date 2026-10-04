import { createMockVoiceAdapter, type MockVoiceAdapter, type MockVoiceAdapterOptions } from "./mockVoiceAdapter.js";

export type MicPermissionState = "unknown" | "granted" | "denied" | "unsupported";

export interface VoiceCaptureAdapter extends MockVoiceAdapter {
  readonly micPermission: MicPermissionState;
  /** Optional live check (does not start recording). */
  probeMicrophone(): Promise<MicPermissionState>;
}

export interface VoiceCaptureOptions extends MockVoiceAdapterOptions {
  /** When true, attempt getUserMedia before the first capture. */
  readonly preferMicrophone?: boolean;
}

/**
 * Sample-line push-to-talk: every capture returns the next canned transcript and never records
 * the user. Real speech goes through the server STT path in `ConversationPanel` instead.
 * `probeMicrophone` only reports permission; a granted microphone does not mean speech recognition
 * is available.
 */
export function createVoiceCapture(options: VoiceCaptureOptions = {}): VoiceCaptureAdapter {
  const inner = createMockVoiceAdapter(options);
  let micPermission: MicPermissionState = "unknown";

  async function probeMicrophone(): Promise<MicPermissionState> {
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      micPermission = "unsupported";
      return micPermission;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      for (const track of stream.getTracks()) track.stop();
      micPermission = "granted";
    } catch {
      micPermission = "denied";
    }
    return micPermission;
  }

  return {
    get state() {
      return inner.state;
    },
    get micPermission() {
      return micPermission;
    },
    probeMicrophone,
    peekTranscript() {
      return inner.peekTranscript();
    },
    start() {
      if (options.preferMicrophone && micPermission === "unknown") {
        void probeMicrophone();
      }
      inner.start();
    },
    commit() {
      return inner.commit();
    },
    cancel() {
      inner.cancel();
    },
  };
}
