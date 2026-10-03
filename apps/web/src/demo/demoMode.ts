/** Presentation/demo mode: clearer labels and scripted mock replies (`?demo=1`). */
export function isDemoMode(search: string): boolean {
  return new URLSearchParams(search).get("demo") === "1";
}
