import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";
import type { RunRecord } from "@ember/simulation";
import { z } from "zod";

const TruthFrame = z.object({
  timeMs: z.number().int().nonnegative(),
  burning: z.array(z.number().int().nonnegative()),
  burned: z.array(z.number().int().nonnegative()),
});

const WorkerReply = z.union([
  z.object({ id: z.number().int(), ok: z.literal(true), frames: z.array(TruthFrame) }),
  z.object({ id: z.number().int(), ok: z.literal(false), error: z.string() }),
  z.object({ ok: z.literal(false), error: z.string() }),
]);

export type ReplayTruthFrame = z.infer<typeof TruthFrame>;

/** How many times this process has started a reveal. Cache hits do not increment it. */
let passes = 0;

export function replayRevealPasses(): number {
  return passes;
}

interface Waiter {
  resolve: (frames: readonly ReplayTruthFrame[]) => void;
  reject: (error: Error) => void;
}

let worker: Worker | null = null;
let nextId = 1;
const waiters = new Map<number, Waiter>();

function failAll(error: Error): void {
  const pending = [...waiters.values()];
  waiters.clear();
  for (const waiter of pending) waiter.reject(error);
}

function workerFilename(): string {
  // The worker sits next to src/ and dist/, so the same relative path works in tests and production.
  return join(dirname(fileURLToPath(import.meta.url)), "..", "replay-reveal-worker.mjs");
}

function getWorker(): Worker {
  if (worker !== null) return worker;
  const created = new Worker(workerFilename());
  // A waiting reveal must not keep the process alive after the server stops.
  created.unref();
  created.on("message", (raw: unknown) => {
    const parsed = WorkerReply.safeParse(raw);
    if (!parsed.success) {
      failAll(new Error("replay worker sent an invalid result"));
      return;
    }
    if (!("id" in parsed.data)) {
      failAll(new Error(parsed.data.error));
      return;
    }
    const waiter = waiters.get(parsed.data.id);
    if (waiter === undefined) return;
    waiters.delete(parsed.data.id);
    if (parsed.data.ok) waiter.resolve(parsed.data.frames);
    else waiter.reject(new Error(parsed.data.error));
  });
  created.on("error", (error: Error) => {
    if (worker === created) worker = null;
    failAll(error);
  });
  created.on("exit", (code: number) => {
    if (worker === created) worker = null;
    if (waiters.size > 0) failAll(new Error(`replay worker exited (${code})`));
  });
  worker = created;
  return created;
}

/** Re-run a saved record off the HTTP/pump thread. One call is one reveal pass. */
export function revealFireOffLoop(record: RunRecord, frameEveryMs: number): Promise<readonly ReplayTruthFrame[]> {
  passes += 1;
  const id = nextId++;
  return new Promise((resolve, reject) => {
    waiters.set(id, { resolve, reject });
    try {
      getWorker().postMessage({ id, record, frameEveryMs });
    } catch (error) {
      waiters.delete(id);
      passes -= 1;
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
}

export async function stopReplayWorker(): Promise<void> {
  const current = worker;
  worker = null;
  if (current === null) return;
  await current.terminate();
}
