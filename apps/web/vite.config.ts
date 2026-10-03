import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { scenarioFilesPlugin } from "./scenarioPlugin.js";

export default defineConfig({
  plugins: [react(), scenarioFilesPlugin()],
  server: {
    port: 5173,
    proxy: {
      "/incidents": "http://localhost:3000",
      "/health": "http://localhost:3000",
    },
  },
});
