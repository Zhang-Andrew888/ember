// Process entry point for the browser-facing HTTP + WebSocket server.
// `index.ts` is the library barrel and starts nothing; this file is what `pnpm dev` / `pnpm start` run.
import { startHttpApp } from "./http-app.js";

function portFromEnv(): number {
  const raw = process.env["PORT"];
  if (raw === undefined || raw === "") return 3000;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 65535) {
    throw new Error(`PORT must be an integer in [0, 65535]; got "${raw}"`);
  }
  return parsed;
}

async function main(): Promise<void> {
  const app = await startHttpApp({ port: portFromEnv() });
  // The web dev server (apps/web/vite.config.ts) proxies /incidents and /health to this address.
  process.stdout.write(`ember-server listening on http://127.0.0.1:${app.port}\n`);

  let closing = false;
  const shutdown = (): void => {
    if (closing) return;
    closing = true;
    process.stdout.write("ember-server shutting down\n");
    void app.close().then(
      () => process.exit(0),
      () => process.exit(1),
    );
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((error: unknown) => {
  process.stderr.write(`ember-server failed to start: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
