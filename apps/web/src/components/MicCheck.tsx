import { useState } from "react";
import type { MicPermissionState } from "../net/voiceCapture.js";

export interface MicCheckProps {
  readonly onProbe: () => Promise<MicPermissionState>;
}

const LABEL: Record<MicPermissionState, string> = {
  unknown: "Not checked yet",
  granted: "Microphone available",
  denied: "Microphone blocked, use text input",
  unsupported: "Microphone not available in this browser, use text input",
};

/**
 * Microphone status for the briefing. The browser's permission prompt only appears when the presenter
 * presses "Check microphone", never as a side effect of loading the page (issue #51).
 */
export function MicCheck({ onProbe }: MicCheckProps) {
  const [state, setState] = useState<MicPermissionState>("unknown");
  const [checking, setChecking] = useState(false);

  const check = () => {
    setChecking(true);
    void onProbe()
      .then(setState)
      .finally(() => setChecking(false));
  };

  return (
    <div className="briefing__mic">
      <p className="briefing__mic-status" role="status">
        {LABEL[state]}. Text input is always available.
      </p>
      <button type="button" onClick={check} disabled={checking}>
        {checking ? "Checking…" : "Check microphone"}
      </button>
    </div>
  );
}
