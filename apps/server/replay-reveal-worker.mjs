import { parentPort } from "node:worker_threads";
import { revealFire } from "@ember/replay";
import { RunRecord } from "@ember/simulation";
import { z } from "zod";

const Request = z.object({
  id: z.number().int(),
  frameEveryMs: z.number().int().positive(),
  record: z.unknown(),
});

if (parentPort === null) {
  throw new Error("replay worker requires parentPort");
}

parentPort.on("message", (raw) => {
  const parsed = Request.safeParse(raw);
  if (!parsed.success) {
    parentPort.postMessage({ ok: false, error: "invalid replay request" });
    return;
  }
  try {
    const reveal = revealFire(RunRecord.parse(parsed.data.record), parsed.data.frameEveryMs);
    parentPort.postMessage({
      id: parsed.data.id,
      ok: true,
      frames: reveal.frames.map((frame) => ({
        timeMs: frame.timeMs,
        burning: [...frame.burning],
        burned: [...frame.burned],
      })),
    });
  } catch (error) {
    parentPort.postMessage({
      id: parsed.data.id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});
