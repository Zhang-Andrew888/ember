import { CoordinatorView, WIRE_PROTOCOL_VERSION } from "@ember/domain";

/** Parse a server wire frame and return a CoordinatorView when the frame carries one. */
export function parseCoordinatorViewFrame(raw: string): CoordinatorView | null {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (data && typeof data === "object" && "protocolVersion" in data && "message" in data) {
    const envelope = data as { protocolVersion: number; message: unknown };
    if (envelope.protocolVersion !== WIRE_PROTOCOL_VERSION) return null;
    if (envelope.message && typeof envelope.message === "object" && (envelope.message as { type?: string }).type === "view") {
      const view = (envelope.message as { view: unknown }).view;
      const parsed = CoordinatorView.safeParse(view);
      if (parsed.success) return parsed.data;
    }
    return null;
  }
  const direct = CoordinatorView.safeParse(data);
  if (direct.success) return direct.data;
  if (data && typeof data === "object" && "view" in data) {
    const legacy = CoordinatorView.safeParse((data as { view: unknown }).view);
    if (legacy.success) return legacy.data;
  }
  return null;
}

export function encodeClientMessage(message: Record<string, unknown>): string {
  return JSON.stringify({ protocolVersion: WIRE_PROTOCOL_VERSION, message });
}
