import { z } from "zod";

/** Integer milliseconds of simulated incident time (never wall time). */
export const SimTimeMs = z.number().int().nonnegative().brand("SimTimeMs");
export type SimTimeMs = z.infer<typeof SimTimeMs>;

/** Integer milliseconds of real wall-clock elapsed time. */
export const WallTimeMs = z.number().int().nonnegative().brand("WallTimeMs");
export type WallTimeMs = z.infer<typeof WallTimeMs>;

/** Distance in meters in the local scene coordinate system. */
export const Meters = z.number().nonnegative().brand("Meters");
export type Meters = z.infer<typeof Meters>;

/** Accumulated work units (not time). */
export const WorkUnits = z.number().nonnegative().brand("WorkUnits");
export type WorkUnits = z.infer<typeof WorkUnits>;

/** Monotonically increasing integer event/revision counter. */
export const SequenceNumber = z.number().int().nonnegative().brand("SequenceNumber");
export type SequenceNumber = z.infer<typeof SequenceNumber>;
