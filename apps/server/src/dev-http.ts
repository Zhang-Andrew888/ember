/**
 * Dev entry: `pnpm --filter ember-server exec tsx src/dev-http.ts`
 * Listens on port 3000 for Vite proxy + browser testing.
 */
import { startHttpApp } from "./http-app.js";
import { grokIntentEnabled, grokVoiceEnabled } from "./xai/env.js";

const port = Number(process.env.PORT ?? 3000);
const app = await startHttpApp({ port });
process.stdout.write(
  `Ember HTTP on http://127.0.0.1:${app.port} (grokVoice=${grokVoiceEnabled()}, grokIntent=${grokIntentEnabled()})\n`,
);
