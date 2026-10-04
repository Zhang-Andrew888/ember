import { useState } from "react";
import type { MicPermissionState } from "../net/voiceCapture.js";

export interface MicCheckProps {
  readonly onProbe: () => Promise<MicPermissionState>;
}

const LABEL: Record<MicPermissionState, string> = {
  unknown: "",
  granted: "Microphone ready",
  denied: "Microphone blocked. You can use text.",
  unsupported: "Microphone unavailable here. You can use text.",
};

/** Permission probing remains user initiated; a failed probe still leaves text and Start available. */
export function MicCheck({ onProbe }: MicCheckProps) {
  const [status, setStatus] = useState("");
  const [checking, setChecking] = useState(false);

  const check = () => {
    setChecking(true);
    void onProbe()
      .then((state) => setStatus(LABEL[state]))
      .catch(() => setStatus("Couldn’t check the microphone. Try again or use text."))
      .finally(() => setChecking(false));
  };

  return (
    <div className="briefing__mic">
      <button type="button" onClick={check} disabled={checking}>
        {checking ? "Checking…" : "Check microphone"}
      </button>
      <p className="briefing__mic-status" role="status">{status}</p>
    </div>
  );
}
