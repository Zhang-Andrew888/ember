import { useEffect, useId, useRef, type FormEvent } from "react";
import type { MapMovementDraft } from "../map/moveDirectionCommand.js";
import { deliveryLabel, type MapCommandDelivery } from "../command/mapCommandDelivery.js";

export interface MapCommandPanelProps {
  readonly assignMode: boolean;
  readonly onToggleAssignMode: () => void;
  readonly selectedCallsign: string | null;
  readonly selectedAgentId: string | null;
  readonly draft: MapMovementDraft | null;
  readonly pickHint: string | null;
  readonly delivery: MapCommandDelivery | null;
  readonly disabled: boolean;
  readonly onSend: () => void;
  readonly onCancelDraft: () => void;
  readonly open: boolean;
  readonly onOpen: () => void;
  readonly onClose: () => void;
}

export function MapCommandPanel({
  assignMode,
  onToggleAssignMode,
  selectedCallsign,
  selectedAgentId,
  draft,
  pickHint,
  delivery,
  disabled,
  onSend,
  onCancelDraft,
  open,
  onOpen,
  onClose,
}: MapCommandPanelProps) {
  const titleId = useId();
  const sendRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (draft !== null) sendRef.current?.focus();
  }, [draft]);

  const handleFormSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (draft === null || disabled) return;
    onSend();
  };

  const crewLabel =
    selectedCallsign === null ? "Select a crew on the map or rail first." : `Selected crew: ${selectedCallsign}`;

  if (!open) {
    return (
      <button type="button" className="map-command-panel__reopen" onClick={onOpen}>
        Map movement order
      </button>
    );
  }

  return (
    <section className="map-command-panel" aria-labelledby={titleId}>
      <button type="button" className="map-command-panel__close" onClick={onClose} aria-label="Close">
        ×
      </button>
      <h2 id={titleId} className="map-command-panel__title">
        Map movement order
      </h2>
      <p className="map-command-panel__crew" aria-live="polite">
        {crewLabel}
      </p>
      <button
        type="button"
        className="map-command-panel__mode"
        aria-pressed={assignMode}
        disabled={disabled || selectedAgentId === null}
        onClick={onToggleAssignMode}
        title="Shortcut: M when a crew is selected"
      >
        {assignMode ? "Cancel map pick (M)" : "Pick destination on map (M)"}
      </button>
      {assignMode && selectedAgentId !== null ? (
        <p className="map-command-panel__hint" role="status">
          {pickHint ?? "Click the map to set a destination for the selected crew."}
        </p>
      ) : null}
      {draft !== null ? (
        <form className="map-command-panel__preview" onSubmit={handleFormSubmit}>
          <p className="map-command-panel__preview-label">Proposed command</p>
          <blockquote className="map-command-panel__command">{draft.commandText}</blockquote>
          <p className="map-command-panel__meta">
            Direction: {draft.direction} · about {draft.distanceMeters} m
          </p>
          <div className="map-command-panel__actions">
            <button ref={sendRef} type="submit" disabled={disabled}>
              Send command
            </button>
            <button type="button" disabled={disabled} onClick={onCancelDraft}>
              Clear destination
            </button>
          </div>
        </form>
      ) : null}
      {delivery !== null ? (
        <div className="map-command-panel__delivery" role="status" aria-live="polite">
          <span className={`map-command-panel__status map-command-panel__status--${delivery.phase}`}>
            {deliveryLabel(delivery.phase)}
          </span>
          {delivery.explanation ? <span className="map-command-panel__explanation">{delivery.explanation}</span> : null}
        </div>
      ) : null}
    </section>
  );
}
