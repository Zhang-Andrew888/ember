# Communication and Grok Voice

## Accepted audio behavior

The coordinator uses one visible conversation and addresses one crew or scout at a time. Incoming reports never retarget the conversation.

If an urgent call arrives while push-to-talk is held, show the alert and transcript immediately, preserve the recording, and give the call first audio priority when the user releases. If audio is ready, start it on release; otherwise show “urgent audio preparing” and play it as soon as available. Crew withdrawal or retreat has already started.

If routine speech is playing when an urgent report arrives, stop routine playback immediately and play the urgent report. If the coordinator begins recording, suspend playback to avoid recording the application voice. Routine content may be replayed only if still relevant.

## Integration decision

Use Grok Realtime for microphone input and structured interpretation, and xAI text-to-speech for event-grounded outgoing speech. Both belong to the Grok Voice API family. This avoids asking a free-running voice character to invent an agent decision.

Current official documentation describes manual audio submission, custom function calls, and bidirectional text/audio in Realtime. Input is committed after push-to-talk release; custom function results are returned before requesting continuation. [Speech-to-speech guide](https://docs.x.ai/developers/model-capabilities/audio/speech-to-speech).

The API reference documents input commit, response cancellation, conversation item deletion/truncation, and completed input transcription events. These support an application-owned capture and playback policy. [Voice API reference](https://docs.x.ai/developers/rest-api-reference/inference/voice).

For outgoing speech, submit the exact committed report text to xAI TTS, which supports REST and streaming synthesis. Default to REST synthesis of short utterances with client playback buffering; use streaming if measured latency warrants it. [Text-to-speech guide](https://docs.x.ai/developers/model-capabilities/audio/text-to-speech?campaign=stt-tts-blog).

Provider facts above were checked on 2026-10-03. No paid API request, microphone test, or latency benchmark has been run against xAI in this repo.

## As implemented (no provider)

For development, CI, and offline evaluation, `packages/communication` provides:

- **`ScriptedInterpreter`** — deterministic keyword/parser stand-in for Grok Realtime (not a language model).
- **`CommandGateway`** — persistent addressed recipient, clarification, evidence from received reports only, idempotent command IDs, 5 s / 10 s interpretation timeouts, incident-end rejection.
- **`AudioScheduler`** — urgent-over-routine, recording suspends playback, relevance checks, coalescing, end-of-incident flush; reports `audio_unavailable` on playback failure.
- **`PushToTalk`** — begin/release/lost-focus lifecycle with wall-clock timing on the server hub.

The web uses a **mock voice capture adapter** and **exact-text speech playback stub** for UI testing. Live voice records microphone audio for the server's `/incidents/:id/stt` endpoint and plays prepared xAI TTS audio (`apps/server/src/xai`, `apps/web/src/net/browserVoiceCapture.ts`, and `grokSpeechPlayback.ts`). Optional Grok intent interpretation is implemented on the server. Realtime speech-to-speech and live provider/microphone validation remain open; the Realtime design below describes that remaining integration.

## Session organization

One server-owned Realtime interpreter session per incident handles coordinator input. It is a communication interpreter, not a crew. Its context contains public entity names, allowed intents, the active recipient, pending clarification, and recent coordinator utterances. It receives neither hidden world state nor every crew's private reasoning.

Keep the complete visible transcript in application storage. Do not replay it as each crew's memory. Crews produce authoritative structured outcomes from scoped knowledge. Narration requests contain only a single committed report/answer and the chosen voice; they cannot call movement tools.

Relay microphone data browser → server → provider. The provider key remains on the server. Start with manual turn detection and documented PCM audio format; implement explicit browser resampling to the configured provider rate. Use one tested built-in voice initially, with spoken callsigns; distinct voices are optional polish after correctness.

Typed messages enter the same interpreter as text. No external web search, remote MCP tools, or autonomous external actions are exposed to that interpreter.

## Capture lifecycle

1. Pointer/key down: capture the active-recipient context and begin audio; suppress local speech playback.
2. While held: stream audio, display recording, and accept immediate visual urgent reports.
3. Release: commit the complete input once; prioritize already queued urgent audio.
4. Interpret and validate the input while playback is independently scheduled.
5. Apply clear valid commands at the next eligible simulation tick using current agent knowledge and position.
6. Add the authoritative result to the transcript and speech queue.

A name explicitly spoken in the new message can override the captured recipient. An incoming report cannot. Late interpretation of a previous message cannot overwrite a newer explicitly established recipient. Use input sequence numbers and recipient-context revisions.

Resolve recipient context in input order. If a follow-up arrives while an earlier address is still being interpreted, queue that addressing decision rather than guessing its recipient. Once addressing is resolved, command evaluation still uses current simulation state. This queue affects communication, never the incident clock or survival behavior.

Lost focus or pointer cancellation finishes capture without leaving a stuck microphone. A disconnect before complete submission marks the utterance unsent and retains any available transcript for explicit resend; do not silently execute half an instruction.

## Supported intent contract

The interpreter proposes a schema-validated envelope:

```ts
type IntentEnvelope = {
  commandId: string;
  inputSequence: number;
  explicitRecipient?: string;
  kind: "objective" | "relay" | "status" | "clarification_answer";
  objective?: {
    kind: "protect" | "observe" | "return" | "hold" | "avoid" | "resume";
    targetName?: string;
  };
  evidenceQueries: Array<{
    sourceName?: string;
    locationName?: string;
    timeSelector?: "latest" | "referenced";
    referencedReportId?: string;
  }>;
  unsupportedClaims: string[];
  clarification?: string;
};
```

The server, not the model, creates authoritative IDs, resolves entities/evidence, and authorizes recipients. The model may propose observations to relay by query; it cannot create an observation or mark a road safe.

Use a custom interpretation function with this shape rather than accepting arbitrary prose as an action. Tool results are structured receipts. Reject multi-recipient instructions with a concise clarification because broadcast commands are outside the chosen interaction model.

## Evidence handling

Resolve evidence only from the coordinator's actual received incident picture. A unique matching source/location/time reference can be attached automatically; no map attachment control is needed.

Evidence references distinguish sensor observations from agent reports. A relayed crew route or objective can inform the scout's relevance estimate, but a reported forecast is not converted into a measured fire observation. Only registered sensor observations update the forecast's observation constraints. The interpreter cannot change an evidence item's type or source.

“Crew 2, use Scout's latest east-corridor report and protect the lodge” becomes a targeted observation relay plus objective. “Crew 2, the east road is definitely safe” without matching evidence remains an unsupported claim. Neither spoken certainty nor model confidence bypasses the check.

When multiple observations could be meant, ask which report/location. When an observation is old, preserve the timestamp and evaluate its age rather than silently refreshing it. Newer local observations take precedence for current conditions. Relay useful supported content even if the accompanying objective is infeasible; the receipt distinguishes evidence received from objective rejected.

Objectives such as “avoid the east corridor” do not need observational proof. They are constraints or priorities and still pass through the crew's feasibility checks.

## Replies and clarification

Build replies from reason-coded planner results. Clear commands do not require a second confirmation. Unknown recipient/target or materially ambiguous meaning produces a clarification. Existing feasible execution continues while waiting.

Loss announcements come from the simulation's control narration, not a new utterance attributed to the lost crew. Other agent replies use only that agent's reportable knowledge and committed decisions.

Allow a narrow set of conversational queries: current action, accepted objective, return estimate, reason for rejection/withdrawal, known conditions, and last report. Unsupported general conversation receives a concise capability explanation without inventing incident facts.

Plain language is the default. A radio-style preference adds callsign-first phrasing and shorter sentences; it does not alter the command schema or hide uncertainty. Example: “Crew 2, withdrawing west. Our observed eastern access is closing. Current estimate: two incident minutes to refuge.”

## Audio scheduler

Priority tiers: incident loss/stranding and emergency retreat; automatic withdrawal; direct command response/clarification; routine discovery/status. Within a tier preserve event order. Urgent events interrupt routine speech; do not repeatedly interrupt one urgent sentence with another unless it becomes invalid.

Every speech item references event ID, agent ID, text, created time, and plan revision. Before playback, check relevance. Discard superseded routine plans; regenerate a current summary if useful. Keep the original text event in the transcript. Never stitch together a canceled sentence and a new plan as though both were current.

Start urgent synthesis when the event arrives, including during recording, so audio can be ready at release. Client playback cancellation drops queued samples immediately; provider cancellation is separate and cannot substitute for clearing the browser buffer. Receiving reports never changes command addressing.

Keep routine speech under roughly 10 seconds and avoid narrating every sensor tick. Coalesce identical reports; a repeated urgent situation remains visibly active even if its audio is deduplicated.

## Failures and end behavior

If interpretation is not complete after 5 real seconds, show “still interpreting”; after 10 seconds mark the input failed, release its pending action, and invite text/resend. Late results for a failed command are ignored. Provider retries retain the same command ID and cannot duplicate an objective.

If speech fails, retain the exact text report and urgent visual state, display audio unavailable, and allow typed interaction. Do not freeze the incident or claim that the crew heard a message that never applied. Text commands still require the language interpreter; provider-independent status and existing autonomous behavior remain available during an outage.

At incident end, stop capture, cancel unapplied commands and stale routine audio, and allow one concise end announcement. Reports already committed remain in the transcript. The debrief does not auto-play a backlog of obsolete radio traffic.

Acceptance scenarios are specified in [validation](VALIDATION.md).
