/** Scene tuning is opt-in even on the development server used for a presentation. */
export function sceneDebugEnabled(search: string): boolean {
  return new URLSearchParams(search).get("debug") === "1";
}
