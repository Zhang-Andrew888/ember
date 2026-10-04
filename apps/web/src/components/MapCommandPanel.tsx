import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import type { CompassDirection } from "@ember/domain";
import {
  COMPASS_DIRECTIONS,
  DEFAULT_TRAVEL_CAP_M,
  TRAVEL_CAP_CHOICES_M,
  type MapMovementDraft,
} from "../map/moveDirectionCommand.js";
import { deliveryGuidance, deliveryLabel, type CommandDelivery } from "../command/commandDelivery.js";
import type { CrewDetails } from "./crewDetails.js";

export interface MapCommandPanelProps {
  readonly assignMode: boolean;
  readonly onToggleAssignMode: () => void;
  /** Crew selected for inspection. A draft keeps its own recipient, which may differ. */
  readonly selectedCallsign: string | null;
  readonly selectedAgentId: string | null;
  /** Reported details for the inspected crew. */
  readonly crew?: CrewDetails | null;
  /** Puts the crew's callsign in the message box without sending anything. */
  readonly onPrepareMessage?: (callsign: string) => void;
  readonly draft: MapMovementDraft | null;
  readonly pickHint: string | null;
  readonly delivery: CommandDelivery | null;
  readonly disabled: boolean;
  readonly onDraftDirection: (direction: CompassDirection, capMeters: number) => void;
  readonly onSend: () => void;
  readonly onCancelDraft: () => void;
  readonly open: boolean;
  readonly onOpen: () => void;
  readonly onClose: () => void;
}

/** Plain-language consequence of a draft, shown before Send. */
export function draftExplanation(draft: MapMovementDraft): string {
  const limit = draft.capStated
    ? `up to about ${draft.capMeters} m`
    : `up to about ${draft.capMeters} m (the default limit)`;
  const picked =
    draft.pickedDistanceMeters === null
      ? ""
      : ` It will not go to the exact point you picked (about ${draft.pickedDistanceMeters} m away).`;
  return `${draft.callsign} heads ${draft.direction} ${limit}, chooses its own path, and stops at the nearest safe road.${picked}`;
}

export function MapCommandPanel({
  assignMode,
  onToggleAssignMode,
  selectedCallsign,
  selectedAgentId,
  crew = null,
  onPrepareMessage,
  draft,
  pickHint,
  delivery,
  disabled,
  onDraftDirection,
  onSend,
  onCancelDraft,
  open,
  onOpen,
  onClose,
}: MapCommandPanelProps) {
  const titleId = useId();
  const directionId = useId();
  const limitId = useId();
  const sendRef = useRef<HTMLButtonElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const reopenRef = useRef<HTMLButtonElement>(null);
  const focusAfterToggle = useRef<"heading" | "reopen" | null>(null);
  const [direction, setDirection] = useState<CompassDirection>("north");
  const [capMeters, setCapMeters] = useState(DEFAULT_TRAVEL_CAP_M);

  useEffect(() => {
    if (draft !== null) sendRef.current?.focus();
  }, [draft]);

  useEffect(() => {
    const target = focusAfterToggle.current;
    focusAfterToggle.current = null;
    if (target === "heading") headingRef.current?.focus();
    if (target === "reopen") reopenRef.current?.focus();
  }, [open]);

  const handleFormSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (draft === null || disabled) return;
    onSend();
  };

  const handleDirectionSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (disabled || selectedAgentId === null) return;
    onDraftDirection(direction, capMeters);
  };

  if (!open) {
    return (
      <button
        ref={reopenRef}
        type="button"
        className="map-command-panel__reopen"
        onClick={() => {
          focusAfterToggle.current = "heading";
          onOpen();
        }}
      >
        Selected crew and movement order
      </button>
    );
  }

  const draftForOtherCrew = draft !== null && selectedAgentId !== null && draft.agentId !== selectedAgentId;
  const canDraft = !disabled && selectedAgentId !== null;

  return (
    <section className="map-command-panel" aria-labelledby={titleId}>
      <button
        type="button"
        className="map-command-panel__close"
        onClick={() => {
          focusAfterToggle.current = "reopen";
          onClose();
        }}
        aria-label={draft === null ? "Close selected crew panel" : "Close selected crew panel and discard the unsent draft"}
      >
        ×
      </button>
      <h2 id={titleId} ref={headingRef} tabIndex={-1} className="map-command-panel__title">
        Selected crew
      </h2>
      <p className="map-command-panel__crew">
        {selectedCallsign === null ? "Select a crew on the map or crew rail to inspect it." : `Inspecting ${selectedCallsign}`}
      </p>
      {crew !== null ? (
        <dl className="map-command-panel__details">
          <dt>State</dt>
          <dd>{crew.stateLabel}</dd>
          <dt>Objective</dt>
          <dd>{crew.objective ?? "No reported plan"}</dd>
          {crew.limitingReason !== null ? (
            <>
              <dt>Limited by</dt>
              <dd>{crew.limitingReason}</dd>
            </>
          ) : null}
          <dt>Last report</dt>
          <dd>{crew.reported}</dd>
        </dl>
      ) : null}
      {crew !== null && onPrepareMessage ? (
        <button
          type="button"
          className="map-command-panel__prepare"
          disabled={disabled}
          onClick={() => onPrepareMessage(crew.callsign)}
        >
          Prepare message to {crew.callsign}
        </button>
      ) : null}
      <h3 className="map-command-panel__subtitle">Movement order</h3>
      {draft === null ? (
        <>
          <button
            type="button"
            className="map-command-panel__mode"
            aria-pressed={assignMode}
            disabled={!canDraft}
            onClick={onToggleAssignMode}
            title="Shortcut: M when a crew is selected"
          >
            {assignMode
              ? "Cancel map pick (M)"
              : selectedCallsign === null
                ? "Pick a direction on the map (M)"
                : `Pick a direction for ${selectedCallsign} (M)`}
          </button>
          {assignMode && selectedAgentId !== null ? (
            <p className="map-command-panel__hint" role="status">
              {pickHint ?? "Click the map in the direction the crew should head. The crew picks its own route."}
            </p>
          ) : null}
          <details className="map-command-panel__keyboard">
            <summary>Choose a direction without the map</summary>
            <form className="map-command-panel__direction-form" onSubmit={handleDirectionSubmit}>
              <label htmlFor={directionId}>
                Direction
                <select
                  id={directionId}
                  value={direction}
                  onChange={(event) => setDirection(event.target.value as CompassDirection)}
                  disabled={!canDraft}
                >
                  {COMPASS_DIRECTIONS.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </label>
              <label htmlFor={limitId}>
                Travel limit
                <select
                  id={limitId}
                  value={capMeters}
                  onChange={(event) => setCapMeters(Number(event.target.value))}
                  disabled={!canDraft}
                >
                  {TRAVEL_CAP_CHOICES_M.map((option) => (
                    <option key={option} value={option}>
                      {option === DEFAULT_TRAVEL_CAP_M ? `About ${option} m (default)` : `Up to ${option} m`}
                    </option>
                  ))}
                </select>
              </label>
              <button type="submit" disabled={!canDraft}>
                Draft order
              </button>
            </form>
          </details>
        </>
      ) : (
        <form className="map-command-panel__preview" onSubmit={handleFormSubmit}>
          <p className="map-command-panel__preview-label">Draft order for {draft.callsign} (not sent)</p>
          {draftForOtherCrew ? (
            <p className="map-command-panel__warning" role="status">
              This draft is still addressed to {draft.callsign}, not {selectedCallsign}. Clear it to draft for{" "}
              {selectedCallsign}.
            </p>
          ) : null}
          <blockquote className="map-command-panel__command">{draft.commandText}</blockquote>
          <p className="map-command-panel__meta">
            Direction cue, not a route. {draftExplanation(draft)}
          </p>
          <div className="map-command-panel__actions">
            <button ref={sendRef} type="submit" disabled={disabled}>
              Send to {draft.callsign}
            </button>
            <button type="button" disabled={disabled} onClick={onCancelDraft}>
              Clear draft
            </button>
          </div>
          <p className="map-command-panel__meta">Closing this panel discards the unsent draft.</p>
        </form>
      )}
      {delivery !== null ? (
        <div className="map-command-panel__delivery" role="status" aria-live="polite">
          <span className="map-command-panel__delivery-subject">
            Last order to {delivery.callsign ?? "a crew"}: {delivery.commandText}
          </span>
          <span className={`map-command-panel__status map-command-panel__status--${delivery.phase}`}>
            {deliveryLabel(delivery.phase)}
          </span>
          {delivery.explanation ? <span className="map-command-panel__explanation">{delivery.explanation}</span> : null}
          {deliveryGuidance(delivery.phase) ? (
            <span className="map-command-panel__explanation">{deliveryGuidance(delivery.phase)}</span>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
