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

export interface ReservedBox {
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
}

/**
 * Two entities at the same node (an agent idle at a refuge, a crew working
 * on-site) project to the same screen point and their labels overlap
 * illegibly otherwise (docs/FRONTEND.md "legible ... states" requirement -
 * found live via a Playwright smoke check, not a type error). Places labels
 * in input order, clearing prior labels and fixed overlays. With viewport
 * bounds, searches nearby positions in both directions and hides only labels
 * that cannot fit. Without bounds, retains the upward-stack behavior.
 * Pure/testable: measured box sizes are passed in by the caller.
 *
 * `reservedBoxes` seeds the collision set with fixed UI regions (the scene
 * legend, an inspection panel) that don't move with the camera - a label
 * can still render underneath one of those as the camera pans, which is
 * just as illegible as two labels overlapping each other (also found via
 * a Playwright smoke check, at the smaller 1024x720 target viewport).
 */
export function resolveLabelCollisions(
  points: SizedLabelPoint[],
  verticalGap = 3,
  reservedBoxes: ReservedBox[] = [],
  viewport?: { readonly width: number; readonly height: number },
): PlacedLabel[] {
  const placedBoxes: Array<{ left: number; right: number; top: number; bottom: number }> = [...reservedBoxes];
  const result: PlacedLabel[] = [];

  for (const point of points) {
    if (!point.visible) {
      result.push({ id: point.id, x: point.x, y: point.y, visible: false });
      continue;
    }

    if (viewport) {
      const padding = 4;
      const minX = padding + point.width / 2;
      const maxX = viewport.width - padding - point.width / 2;
      const minY = padding + point.height;
      const maxY = viewport.height - padding;
      const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
      const anchorX = clamp(point.x, minX, maxX);
      const anchorY = clamp(point.y, minY, maxY);
      if (minX > maxX || minY > maxY) {
        result.push({ id: point.id, x: anchorX, y: anchorY, visible: false });
        continue;
      }
      const clear = ({ x, y }: { x: number; y: number }) => !placedBoxes.some((box) =>
        x - point.width / 2 < box.right && x + point.width / 2 > box.left
        && y - point.height < box.bottom && y > box.top,
      );
      if (clear({ x: anchorX, y: anchorY })) {
        placedBoxes.push({ left: anchorX - point.width / 2, right: anchorX + point.width / 2,
          top: anchorY - point.height, bottom: anchorY });
        result.push({ id: point.id, x: anchorX, y: anchorY, visible: true });
        continue;
      }
      // Search both sides of each obstruction. Upward-only stacking loses refuges at the top edge.
      const candidates = [{ x: anchorX, y: anchorY }, ...placedBoxes.flatMap((box) => {
        const left = box.left - verticalGap - point.width / 2;
        const right = box.right + verticalGap + point.width / 2;
        const above = box.top - verticalGap;
        const below = box.bottom + verticalGap + point.height;
        // Eight candidates per obstruction, not a Cartesian product of all edges.
        return [
          { x: anchorX, y: above }, { x: anchorX, y: below },
          { x: left, y: anchorY }, { x: right, y: anchorY },
          { x: left, y: above }, { x: left, y: below },
          { x: right, y: above }, { x: right, y: below },
        ];
      })]
        .filter(({ x, y }) => x >= minX && x <= maxX && y >= minY && y <= maxY)
        .sort((a, b) => (a.x - anchorX) ** 2 + (a.y - anchorY) ** 2
          - ((b.x - anchorX) ** 2 + (b.y - anchorY) ** 2));
      const placement = candidates.find(clear);
      if (placement) {
        placedBoxes.push({ left: placement.x - point.width / 2, right: placement.x + point.width / 2,
          top: placement.y - point.height, bottom: placement.y });
      }
      result.push({ id: point.id, x: placement?.x ?? anchorX, y: placement?.y ?? anchorY, visible: !!placement });
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
