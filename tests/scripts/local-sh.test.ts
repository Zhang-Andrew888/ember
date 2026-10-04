import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const root = join(import.meta.dirname, "../..");
const temporaryRoots: string[] = [];

afterEach(() => {
  for (const dir of temporaryRoots.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function launch(rootEnv = "", serverEnv = "", occupied = "") {
  const dir = mkdtempSync(join(tmpdir(), "ember-local-"));
  temporaryRoots.push(dir);
  mkdirSync(join(dir, "scripts/lib"), { recursive: true });
  mkdirSync(join(dir, "apps/server"), { recursive: true });
  mkdirSync(join(dir, "bin"));
  copyFileSync(join(root, "scripts/local.sh"), join(dir, "scripts/local.sh"));
  copyFileSync(join(root, "scripts/lib/demo-ports.sh"), join(dir, "scripts/lib/demo-ports.sh"));
  writeFileSync(join(dir, ".env"), rootEnv);
  writeFileSync(join(dir, "apps/server/.env"), serverEnv);
  // Simulate both IPv4 and IPv6 listeners without consuming real developer ports.
  writeFileSync(join(dir, "bin/lsof"), `#!/usr/bin/env bash
case " $OCCUPIED " in *" \${1#-iTCP:} "*) echo 'node TCP (LISTEN)' ;; esac
`, { mode: 0o755 });
  writeFileSync(join(dir, "scripts/demo.sh"), `#!/usr/bin/env bash
test "$XAI_API_KEY" = 'test-local-key' || exit 9
printf 'LAUNCHED %s %s %s seed=%s ws=%s\n' "$PORT" "$WEB_PORT" "$EMBER_SERVER_PORT" "$DEMO_SEED" "$VITE_INCIDENT_WS_URL"
exit 0
`);
  return spawnSync("bash", [join(dir, "scripts/local.sh")], {
    cwd: tmpdir(),
    encoding: "utf8",
    env: {
      PATH: `${join(dir, "bin")}:${process.env.PATH ?? "/usr/bin:/bin"}`,
      OCCUPIED: occupied,
      XAI_API_KEY: "test-local-key",
      DEMO_SEED: "",
      VITE_INCIDENT_WS_URL: "ws://stale-server/incidents/old",
    },
  });
}

describe("one-command local launcher", () => {
  it("is valid Bash", () => {
    execFileSync("bash", ["-n", "scripts/local.sh"], { cwd: root });
  });

  it("loads both env files from the repo, skips occupied ports, and aligns the proxy", () => {
    const result = launch(
      "PORT=2999\nWEB_PORT=5173\nEMBER_SERVER_PORT=9999\n",
      "PORT=3000\nXAI_API_KEY=test-local-key\nDEMO_SEED=demo-1\n",
      "3000 3001 5173",
    );
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("LAUNCHED 3002 5174 3002 seed=demo-1 ws=\n");
    expect(result.stdout).not.toContain("test-local-key");
    expect(result.stderr).not.toContain("test-local-key");
  });

  it("uses defaults and inherited credentials when env files are empty", () => {
    const result = launch();
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("LAUNCHED 3000 5173 3000");
  });

  it("never assigns the same free port to both apps", () => {
    const result = launch("WEB_PORT=3000\n");
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("LAUNCHED 3000 3001 3000");
  });

  it.each(["invalid", "0", "65536"])("rejects invalid port %s before launch", (port) => {
    const result = launch(`PORT=${port}\n`);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("PORT must be an integer");
    expect(result.stdout).not.toContain("LAUNCHED");
  });

  it("fails clearly when no higher port is available", () => {
    const result = launch("PORT=65535\n", "", "65535");
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("No free port found");
    expect(result.stdout).not.toContain("LAUNCHED");
  });
});
