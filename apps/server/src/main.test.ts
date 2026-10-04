import { dirname } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const serverRoot = dirname(dirname(fileURLToPath(import.meta.url)));

function launch(port: string) {
  const child = spawn(process.argv[0]!, ["--import", "tsx", "src/main.ts"], {
    cwd: serverRoot, env: { ...process.env, PORT: port, XAI_API_KEY: "" }, stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (data: { toString(): string }) => { output += data.toString(); });
  child.stderr.on("data", (data: { toString(): string }) => { output += data.toString(); });
  const exited = new Promise<number | null>((resolve, reject) => {
    child.on("error", reject);
    child.on("exit", resolve);
  });
  return { child, exited, output: () => output };
}

describe("main process entrypoint", () => {
  it("starts the HTTP application and shuts down on SIGTERM", async () => {
    const run = launch("0");
    try {
      const deadline = Date.now() + 20_000;
      while (!run.output().includes("listening on")) {
        if (run.child.exitCode !== null || Date.now() > deadline) throw new Error(run.output() || "startup timed out");
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      const port = /listening on http:\/\/127\.0\.0\.1:(\d+)/.exec(run.output())?.[1];
      expect(port).toBeDefined();
      expect((await fetch(`http://127.0.0.1:${port}/health`)).status).toBe(200);
      run.child.kill("SIGTERM");
      expect(await run.exited).toBe(0);
      expect(run.output()).toContain("shutting down");
    } finally {
      if (run.child.exitCode === null) run.child.kill("SIGKILL");
      await run.exited;
    }
  }, 30_000);

  it("rejects invalid port configuration before listening", async () => {
    const run = launch("70000");
    expect(await run.exited).toBe(1);
    expect(run.output()).toContain("PORT must be an integer");
    expect(run.output()).not.toContain("listening on");
  }, 30_000);
});
