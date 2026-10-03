import { z } from "zod";

/** Increment when breaking wire or CoordinatorView shapes; clients must reject unknown major versions. */
export const WIRE_PROTOCOL_VERSION = 1 as const;

export const WireProtocolVersion = z.literal(WIRE_PROTOCOL_VERSION);
export type WireProtocolVersion = z.infer<typeof WireProtocolVersion>;
