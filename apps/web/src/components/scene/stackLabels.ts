export interface SizedLabelPoint {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly visible: boolean;
  readonly width: number;
  readonly height: number;
}

export interface PlacedLabel {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly visible: boolean;
}

/**
 * Two entities at the same node (an agent idle at a refuge, a crew working
 * on-site) project to the same screen point and their labels overlap
 * illegibly otherwise (docs/FRONTEND.md "legible ... states" requirement -
 * found live via a Playwright smoke check, not a type error). Pushes each
 * later label straight up, in input order, until its box clears every box
 * already placed. Pure/testable: no DOM measurement, approximate box sizes
 * passed in by the caller.
 */
export function resolveLabelCollisions(points: SizedLabelPoint[], verticalGap = 3): PlacedLabel[] {
  const placedBoxes: Array<{ left: number; right: number; top: number; bottom: number }> = [];
  const result: PlacedLabel[] = [];

  for (const point of points) {
    if (!point.visible) {
      result.push({ id: point.id, x: point.x, y: point.y, visible: false });
      continue;
    }

    const left = point.x - point.width / 2;
    const right = point.x + point.width / 2;
    let bottom = point.y;
    let top = bottom - point.height;

    let collides = true;
    while (collides) {
      collides = placedBoxes.some(
        (box) => left < box.right && right > box.left && top < box.bottom && bottom > box.top,
      );
      if (collides) {
        bottom -= point.height + verticalGap;
        top = bottom - point.height;
      }
    }

    placedBoxes.push({ left, right, top, bottom });
    result.push({ id: point.id, x: point.x, y: bottom, visible: true });
  }

  return result;
}
