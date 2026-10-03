import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { scenarioFilesPlugin } from "./scenarioPlugin.js";

export default defineConfig({
  plugins: [react(), scenarioFilesPlugin()],
  server: {
    port: 5173,
    proxy: {
      "/incidents": { target: "http://localhost:3000", ws: true },
      "/health": "http://localhost:3000",
    },
  },
});
