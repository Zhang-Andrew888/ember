import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { WireSidebandState } from "../conversation/transcript.js";
import { presentNotice, type NoticePresentation } from "../conversation/notices.js";

export interface ActiveServerNotice {
  readonly notice: NoticePresentation | null;
  readonly dismiss: () => void;
}

/**
 * The latest server notice until the coordinator dismisses it. A notice that only describes
 * waiting (still interpreting) clears itself once Control replies.
 */
export function useServerNotice(sideband: WireSidebandState): ActiveServerNotice {
  const [dismissedCount, setDismissedCount] = useState(0);
  const total = sideband.notices.length;
  const latest = total > dismissedCount ? sideband.notices[total - 1]! : null;
  const notice = useMemo(() => (latest === null ? null : presentNotice(latest)), [latest]);
  const replyBaseline = useRef({ notices: 0, replies: 0 });
  const replies = sideband.receipts.length + sideband.transcripts.filter((line) => line.kind === "control").length;

  if (replyBaseline.current.notices !== total) replyBaseline.current = { notices: total, replies };

  useEffect(() => {
    if (notice?.clearsOnReply && replies > replyBaseline.current.replies) setDismissedCount(total);
  }, [notice, replies, total]);

  const dismiss = useCallback(() => setDismissedCount(total), [total]);
  return { notice, dismiss };
}
