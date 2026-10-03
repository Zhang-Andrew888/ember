import { describe, expect, it } from "vitest";
import {
  isSoftwareRenderer,
  parseViewport,
  resultLabel,
  SOFTWARE_LABEL,
  summarizeFrames,
  TARGET_FRAME_MS,
} from "../../scripts/frameStats.mjs";

describe("summarizeFrames", () => {
  it("empty input meets nothing", () => {
    expect(summarizeFrames([])).toMatchObject({ frames: 0, fps: 0, meetsTarget: false });
  });

  it("steady 16.7 ms frames are ~60 fps and meet the target", () => {
    const s = summarizeFrames(new Array(120).fill(16.7));
    expect(s.fps).toBeCloseTo(59.88, 1);
    expect(s.p95Ms).toBe(16.7);
    expect(s.meetsTarget).toBe(true);
    expect(s.over33msShare).toBe(0);
  });

  it("steady 50 ms frames are 20 fps and miss the target", () => {
    const s = summarizeFrames(new Array(60).fill(50));
    expect(s.fps).toBe(20);
    expect(s.meetsTarget).toBe(false);
    expect(s.over33msShare).toBe(1);
  });

  it("a fast mean does not hide a terrible tail", () => {
    const frames = [...new Array(90).fill(10), ...new Array(10).fill(120)];
    const s = summarizeFrames(frames);
    expect(s.fps).toBeGreaterThan(30);
    expect(s.p95Ms).toBe(120);
    expect(s.meetsTarget).toBe(false);
  });

  it("percentiles come from the sorted data and max is the largest frame", () => {
    const s = summarizeFrames([5, 1, 3, 2, 4, 100]);
    expect(s.p50Ms).toBe(3);
    expect(s.maxMs).toBe(100);
  });

  it("budget constant is 1000/30 ms", () => {
    expect(TARGET_FRAME_MS).toBeCloseTo(33.33, 2);
  });
});

describe("result labelling", () => {
  it("recognises software renderers", () => {
    expect(isSoftwareRenderer("ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)")).toBe(true);
    expect(isSoftwareRenderer("llvmpipe (LLVM 15.0.7, 256 bits)")).toBe(true);
    expect(isSoftwareRenderer("ANGLE (Apple, ANGLE Metal Renderer: Apple M2, Unspecified Version)")).toBe(false);
    expect(isSoftwareRenderer(null)).toBe(false);
  });

  it("software rendering is always labelled not representative, even if a machine name is given", () => {
    expect(resultLabel({ renderer: "SwiftShader", machine: "Andrew's laptop", headless: true })).toBe(SOFTWARE_LABEL);
    expect(SOFTWARE_LABEL).toBe("cloud VM, headless Chromium, software rendering, not representative");
  });

  it("a real GPU without a named machine is flagged, never silently accepted", () => {
    const label = resultLabel({ renderer: "NVIDIA GeForce RTX 4070", machine: undefined, headless: false });
    expect(label).toContain("UNNAMED MACHINE");
    expect(label).toContain("--machine");
  });

  it("a real GPU with a named machine reports that name", () => {
    expect(resultLabel({ renderer: "Apple M2", machine: "MacBook Pro M2 (Andrew)", headless: false })).toBe("MacBook Pro M2 (Andrew)");
  });
});

describe("parseViewport", () => {
  it("parses WIDTHxHEIGHT and rejects junk", () => {
    expect(parseViewport("1440x900")).toEqual({ width: 1440, height: 900 });
    expect(() => parseViewport("big")).toThrow();
    expect(() => parseViewport("1440*900")).toThrow();
  });
});
