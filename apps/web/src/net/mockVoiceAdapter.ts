/**
 * Mock push-to-talk capture adapter for backlog item 4 ("push-to-talk
 * release-to-commit... against a mock adapter"). This is explicitly a
 * stand-in for Grok Voice (Slice 0/5, out of this session's scope, and
 * genuinely unreachable from a headless sandbox with no microphone) -
 * it never touches getUserMedia or any real audio API. Release-to-commit
 * yields one of a small set of canned transcripts, standing in for
 * speech-to-text, so the press/hold/release/cancel *interaction pattern*
 * docs/FRONTEND.md specifies can be built and verified without a real
 * voice backend.
 */

export type CaptureState = "idle" | "recording";

export interface VoiceCaptureResult {
  readonly text: string;
}

export interface MockVoiceAdapterOptions {
  /** Holds shorter than this are treated as accidental taps, not a real utterance. */
  readonly minHoldMs?: number;
  readonly now?: () => number;
  readonly transcripts?: readonly string[];
}

export interface MockVoiceAdapter {
  readonly state: CaptureState;
  /** The canned line the next successful commit will return. */
  peekTranscript(): string;
  /** Begins capture. No-op if already recording. */
  start(): void;
  /** Release-to-commit: returns a mock transcript, or null if there was nothing to commit (not recording, or held too briefly). */
  commit(): VoiceCaptureResult | null;
  /** Safely ends capture without committing anything (docs/FRONTEND.md: "release/cancel/lost-focus always ends capture safely"). */
  cancel(): void;
}

const DEFAULT_TRANSCRIPTS: readonly string[] = [
  "Status report, over.",
  "Crew 1, hold position and await instructions.",
  "Crew 2, report your status.",
];

export function createMockVoiceAdapter(options: MockVoiceAdapterOptions = {}): MockVoiceAdapter {
  const minHoldMs = options.minHoldMs ?? 150;
  const now = options.now ?? (() => Date.now());
  const transcripts = options.transcripts ?? DEFAULT_TRANSCRIPTS;

  let state: CaptureState = "idle";
  let startedAt = 0;
  let nextTranscriptIndex = 0;

  return {
    get state() {
      return state;
    },
    peekTranscript() {
      return transcripts[nextTranscriptIndex % transcripts.length]!;
    },
    start() {
      if (state === "recording") return;
      state = "recording";
      startedAt = now();
    },
    commit() {
      if (state !== "recording") return null;
      const heldMs = now() - startedAt;
      state = "idle";
      if (heldMs < minHoldMs) return null;

      const text = transcripts[nextTranscriptIndex % transcripts.length]!;
      nextTranscriptIndex += 1;
      return { text };
    },
    cancel() {
      state = "idle";
    },
  };
}
