/** Readable recovery text for a microphone that failed to start recording. */
export function microphoneStartFailureMessage(error: unknown): string {
  const name = error instanceof Error || error instanceof DOMException ? error.name : "";
  if (name === "NotAllowedError" || name === "SecurityError") {
    return "Microphone permission was denied. Allow microphone access for this page, or type your message.";
  }
  if (name === "NotFoundError" || name === "OverconstrainedError") {
    return "No microphone was found. Connect one, or type your message.";
  }
  if (name === "NotReadableError" || name === "AbortError") {
    return "The microphone is in use or could not start. Try again, or type your message.";
  }
  return "Recording could not start. Try again, or type your message.";
}
