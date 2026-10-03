# Use one conversation for text and push-to-talk communication

The coordinator uses free text and Grok push-to-talk voice in one conversation. Commands are addressed to one crew or scout at a time by name. Map-based assignment and report attachment are outside the intended interaction model.

The last explicitly addressed recipient persists across follow-ups. Incoming reports and map inspection never change it. Unclear recipient or instruction meaning causes clarification while the simulation and existing feasible execution continue. Clear requests do not need confirmation.

Urgent withdrawal/distress reports interrupt routine speech and appear immediately in the transcript. During coordinator push-to-talk, show the urgent call immediately, preserve the recording, and play urgent audio first as soon as the user releases and audio is ready. Agent action never waits for playback. The submitted message retains its intended recipient.

Interpretation proposes validated commands; deterministic agent results supply authoritative reply text, with Grok Voice synthesis for playback. This prevents narrative context from becoming a hidden source of crew knowledge or authority. The full session, evidence, cancellation, and failure policy is specified in [communication](../COMMUNICATION.md).
