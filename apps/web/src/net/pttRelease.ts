import type { OutboundClientMessage } from "./wireProtocol.js";

export interface PttCommandSender {
  sendCommand(message: OutboundClientMessage): void;
}

/**
 * A push-to-talk release commits exactly once.
 * Live mode sends only `ptt_release`; the server already submits that transcript.
 * Mock mode has no server submit, so the caller plays the local mock reply.
 */
export function dispatchPttRelease(options: {
  readonly transcript: string;
  readonly live: PttCommandSender | null;
  readonly mockMode: boolean;
  readonly dispatchSay: (text: string) => void;
}): void {
  if (options.live !== null) {
    options.live.sendCommand({ type: "ptt_release", transcript: options.transcript });
    return;
  }
  if (options.mockMode) options.dispatchSay(options.transcript);
}
