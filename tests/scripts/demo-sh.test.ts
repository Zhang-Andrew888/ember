import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(import.meta.dirname, "../..");

describe("scripts/demo.sh stale-listener guards", () => {
  it("shell sources validate", () => {
    execSync("bash -n scripts/demo.sh", { cwd: root });
    execSync("bash -n scripts/lib/demo-ports.sh", { cwd: root });
  });

  it("requires web and server ports free before bind (IPv4 and IPv6 via lsof)", () => {
    const demo = readFileSync(join(root, "scripts/demo.sh"), "utf8");
    expect(demo).toContain('require_port_free "$WEB_PORT" "web"');
    expect(demo).toContain('require_port_free "$PORT" "server"');
    expect(demo).toMatch(/web ready: http:\/\/127\.0\.0\.1:\$WEB_PORT\//);
    expect(demo).not.toMatch(/web ready: http:\/\/localhost:/);
  });

  it("require_port_free fails when lsof reports a listener", () => {
    const script = `
      source scripts/lib/demo-ports.sh
      lsof() { echo "node 123 TCP [::1]:5173 (LISTEN)"; }
      require_port_free 5173 web
    `;
    expect(() => execSync(`bash -c ${JSON.stringify(script)}`, { cwd: root, stdio: "pipe" })).toThrow();
  });
});
