import { describe, it, expect } from "vitest";
import { OrthographicCamera, Vector3 } from "three";
import { projectToScreen } from "./projectToScreen.js";

function makeCamera(): OrthographicCamera {
  const camera = new OrthographicCamera(-100, 100, 100, -100, 0.1, 1000);
  camera.position.set(0, 100, 0);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  camera.updateProjectionMatrix();
  return camera;
}

describe("components/scene/projectToScreen", () => {
  it("projects the world origin to the center of the viewport", () => {
    const camera = makeCamera();
    const point = projectToScreen(camera, new Vector3(0, 0, 0), 800, 600);
    expect(point.x).toBeCloseTo(400, 0);
    expect(point.y).toBeCloseTo(300, 0);
    expect(point.visible).toBe(true);
  });

  it("moves right on screen as world x increases", () => {
    const camera = makeCamera();
    const center = projectToScreen(camera, new Vector3(0, 0, 0), 800, 600);
    const right = projectToScreen(camera, new Vector3(50, 0, 0), 800, 600);
    expect(right.x).toBeGreaterThan(center.x);
  });

  it("marks a point far outside the clip range as not visible", () => {
    const camera = makeCamera();
    const point = projectToScreen(camera, new Vector3(0, -10_000, 0), 800, 600);
    expect(point.visible).toBe(false);
  });
});
