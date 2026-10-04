import { describe, expect, it } from "vitest";
import { OrthographicCamera } from "three";
import { northBearing } from "./compassMath.js";

function cameraAt(x: number, z: number): OrthographicCamera {
  const camera = new OrthographicCamera(-1, 1, 1, -1, 0.1, 1000);
  camera.position.set(x, 10, z);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  return camera;
}

describe("northBearing", () => {
  it("points to positive scene z from the map's south-side camera", () => {
    expect(northBearing(cameraAt(0, -10))).toBeCloseTo(0);
  });

  it("tracks orbit and reset without changing the world direction", () => {
    const camera = cameraAt(0, 10);
    const resetBearing = northBearing(camera);
    expect(Math.abs(resetBearing)).toBeCloseTo(Math.PI);
    camera.position.set(10, 10, 0);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld();
    expect(northBearing(camera)).toBeCloseTo(-Math.PI / 2);
    camera.position.set(0, 10, 10);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld();
    expect(northBearing(camera)).toBeCloseTo(resetBearing);
  });
});
