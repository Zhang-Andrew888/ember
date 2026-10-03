import { useSyncExternalStore } from "react";
import type { CoordinatorViewClient, CoordinatorViewClientState } from "../net/CoordinatorViewClient.js";

const INITIAL_STATE: CoordinatorViewClientState = {
  status: "connecting",
  view: null,
  sideband: { transcripts: [], receipts: [], audioCues: [] },
};

/**
 * Subscribes a component tree to a CoordinatorViewClient without putting
 * simulation state inside React reconciliation (docs/FRONTEND.md: "keep
 * simulation state out of per-frame React reconciliation"). The client
 * itself is created/closed by the caller (see App.tsx) so its lifecycle is
 * explicit; this hook only reads it.
 */
export function useCoordinatorView(client: CoordinatorViewClient | null): CoordinatorViewClientState {
  return useSyncExternalStore(
    client ? client.subscribe : () => () => {},
    client ? client.getState : () => INITIAL_STATE,
  );
}
