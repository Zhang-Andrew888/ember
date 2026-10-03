/**
 * Removes truth-only fields from raw scenario data before it reaches the
 * browser bundle. Site `requiredWork` is private world state (CLAUDE.md:
 * private parameters never reach the coordinator projection).
 */
const PRIVATE_KEYS: ReadonlySet<string> = new Set(["requiredWork"]);

export function stripPrivateFields(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripPrivateFields);
  if (value !== null && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value)) {
      if (PRIVATE_KEYS.has(key)) continue;
      result[key] = stripPrivateFields(child);
    }
    return result;
  }
  return value;
}
