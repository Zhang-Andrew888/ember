import { useEffect, useState } from "react";
import type { MicPermissionState } from "../net/voiceCapture.js";

export interface MicCheckProps {
  readonly onProbe: () => Promise<MicPermissionState>;
}

const LABEL: Record<MicPermissionState, string> = {
  unknown: "Not checked yet",
  granted: "Microphone available",
  denied: "Microphone blocked — use text input",
  unsupported: "Microphone not available in this browser — use text input",
};

export function MicCheck({ onProbe }: MicCheckProps) {
  const [state, setState] = useState<MicPermissionState>("unknown");

  useEffect(() => {
    void onProbe().then(setState);
  }, [onProbe]);

  return (
    <p className="briefing__mic-status" role="status">
      {LABEL[state]}. Push-to-talk uses demo speech capture until Grok Voice is connected; text input always works.
    </p>
  );
}
