import { describe, expect, it } from "vitest";

// Raw source of every non-test module under src/ (resolved by Vite, no Node typings needed).
const all = import.meta.glob<string>(["../../**/*.ts", "../../**/*.tsx", "!../../**/*.test.ts"], {
  eager: true,
  query: "?raw",
  import: "default",
});
/** Glob keys are relative to this test file; turn them into paths relative to src/. */
function fromSrc(globKey: string): string {
  const parts = ["components", "scene"];
  for (const segment of globKey.split("/")) {
    if (segment === "..") parts.pop();
    else if (segment !== ".") parts.push(segment);
  }
  return parts.join("/");
}
const sources = Object.entries(all).map(([path, source]) => ({ path: fromSrc(path), source }));
const find = (pattern: RegExp) => sources.filter(({ source }) => pattern.test(source)).map(({ path }) => path);

describe("debug panel is dev-only", () => {
  it("is imported only from SceneView, only dynamically, only under import.meta.env.DEV", () => {
    expect(find(/DebugPanel(\.js)?["']/)).toEqual(["components/scene/SceneView.tsx"]);
    const scene = sources.find(({ path }) => path === "components/scene/SceneView.tsx")!.source;
    expect(scene).toContain('import.meta.env.DEV ? lazy(() => import("./DebugPanel.js")) : null');
    expect(scene).not.toMatch(/^import .*DebugPanel/m);
  });

  it("nothing but the panel writes scene params or the quality override", () => {
    expect(find(/qualityStore\.(setParams|resetParams|setMode)\(/)).toEqual(["components/scene/DebugPanel.tsx"]);
  });
});
