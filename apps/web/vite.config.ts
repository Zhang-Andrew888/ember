import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { scenarioFilesPlugin } from "./scenarioPlugin.js";

/** Backend for dev proxy (no CORS on server). Match `PORT` / `scripts/demo.sh`. */
export function devServerProxyTarget(env: NodeJS.ProcessEnv = process.env): string {
  const raw = env.EMBER_SERVER_PORT ?? "3000";
  const port = Number(raw);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`EMBER_SERVER_PORT must be a valid port (got ${JSON.stringify(raw)})`);
  }
  return `http://127.0.0.1:${port}`;
}

const proxyTarget = devServerProxyTarget();

export default defineConfig({
  plugins: [react(), scenarioFilesPlugin()],
  build: {
    manifest: true,
    rollupOptions: {
      output: {
        // Keep the renderer out of the briefing and cache framework code across app updates.
        manualChunks: {
          three: ["three"],
          react: ["react", "react-dom/client"],
        },
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/incidents": { target: proxyTarget, ws: true },
      "/health": proxyTarget,
    },
  },
});
