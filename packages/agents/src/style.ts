/**
 * Per-crew communication style (docs/COMMUNICATION.md): plain language by default; radio adds
 * callsign-first phrasing and shorter sentences. Style never changes the command schema, the
 * reason, or any statement of uncertainty: it only rewrites the opening of a report.
 */
export type CommStyle = "plain" | "radio";

export function applyStyle(callsign: string, text: string, style: CommStyle): string {
  if (style === "plain") return text;
  if (!text.startsWith(callsign)) return `${callsign}, ${text}`;
  const rest = text.slice(callsign.length);
  if (rest.startsWith(", ")) return text;
  // "Crew 2 is withdrawing." -> "Crew 2, withdrawing."; "Crew 2 changed plan: x." -> "Crew 2, plan change: x."
  if (rest.startsWith(" is ")) return `${callsign}, ${rest.slice(4)}`;
  if (rest.startsWith(" changed plan: ")) return `${callsign}, new plan: ${rest.slice(15)}`;
  if (rest.startsWith(" cannot ")) return `${callsign}, cannot ${rest.slice(8)}`;
  return `${callsign},${rest}`;
}
