import type { WireNotice } from "../net/serverWireParse.js";

export interface NoticePresentation {
  readonly tone: "info" | "warning" | "error";
  readonly text: string;
  /** Text the coordinator can put back in the message box (an utterance that was never submitted). */
  readonly restorableText: string | null;
  /** Whether a later reply from Control makes this notice obsolete. */
  readonly clearsOnReply: boolean;
}

/**
 * User copy for each server notice kind. `detail` means something different per kind
 * (apps/server/src/hub.ts): a server command id for `still_interpreting`, the unsent words for
 * `unsent_utterance`, fixed prose otherwise. Internal ids are never shown.
 */
export function presentNotice(notice: Pick<WireNotice, "kind" | "detail">): NoticePresentation {
  switch (notice.kind) {
    case "still_interpreting":
      return {
        tone: "info",
        text: "Control is still interpreting your last message. Wait for the reply before resending.",
        restorableText: null,
        clearsOnReply: true,
      };
    case "unsent_utterance": {
      const words = notice.detail.trim();
      return {
        tone: "warning",
        text:
          words.length > 0
            ? `A voice message was cut off and not sent: \u201c${words}\u201d.`
            : "A voice message was cut off and not sent.",
        restorableText: words.length > 0 ? words : null,
        clearsOnReply: false,
      };
    }
    case "technical_failure":
      return {
        tone: "error",
        text: "A technical problem occurred on the server. A recent message may not have been processed; check for a reply before resending.",
        restorableText: null,
        clearsOnReply: false,
      };
    case "bad_message":
      return {
        tone: "warning",
        text: "The server could not read a message from this page and ignored it.",
        restorableText: null,
        clearsOnReply: false,
      };
    case "backpressure":
      return {
        tone: "error",
        text: "The server fell behind sending updates and is resetting the connection. Recent messages may need resending once it reconnects.",
        restorableText: null,
        clearsOnReply: false,
      };
  }
}
