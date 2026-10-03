import { execSync } from "node:child_process";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(import.meta.dirname, "../..");

describe("scripts/demo-comparison.mjs", () => {
  it("prints held-out aggregates and does not mention showcase-1", () => {
    const out = execSync("node scripts/demo-comparison.mjs", { cwd: root, encoding: "utf8" });
    expect(out).toContain("held-out comparison");
    expect(out).toMatch(/802\.5|600/);
    expect(out).toContain("heldout-15");
    expect(out).toContain("Do not quote showcase-1");
    expect(out).not.toMatch(/showcase-1.*work|Protection work.*showcase/);
  });

  it("demo.sh --comparison delegates to the script", () => {
    const out = execSync("bash scripts/demo.sh --comparison", { cwd: root, encoding: "utf8" });
    expect(out).toContain("Protection work delivered");
  });
});
