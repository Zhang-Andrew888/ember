import { isRoadLeg, type EdgeId, type TimedLeg } from "@ember/domain";

export function routeIdOf(legs: readonly TimedLeg[]): string {
  return legs
    .map((l) => {
      if (l.kind === "off_road") {
        return `or:${l.fromX},${l.fromY}>${l.toX},${l.toY}@${l.endNodeId}`;
      }
      return `${l.edgeId}${l.direction === "forward" ? "+" : "-"}`;
    })
    .join(">");
}

export function edgeKeys(legs: readonly TimedLeg[]): EdgeId[] {
  return [...new Set(legs.filter(isRoadLeg).map((l) => l.edgeId))];
}

export interface ApproachRoute {
  readonly legs: TimedLeg[];
  readonly k: number;
}

/** Discover one timed approach under edge bans; null if the target is unreachable. */
export type ApproachDiscover = (ban: ReadonlySet<EdgeId>) => ApproachRoute | null;

/**
 * Collect distinct approach polylines by iteratively banning an edge from each newly found route.
 * Same timing must still be certified later against every forecast member.
 */
export function enumerateApproachRoutes(
  discover: ApproachDiscover,
  avoid: ReadonlySet<EdgeId>,
  maxRoutes = 6,
): ApproachRoute[] {
  const bases = new Map<string, ApproachRoute>();
  const queue: ReadonlySet<EdgeId>[] = [avoid];
  const seenBans = new Set<string>();

  const banKey = (ban: ReadonlySet<EdgeId>): string => [...ban].sort().join(",");

  while (queue.length > 0 && bases.size < maxRoutes) {
    const ban = queue.shift()!;
    const key = banKey(ban);
    if (seenBans.has(key)) continue;
    seenBans.add(key);

    const found = discover(ban);
    if (found === null) continue;
    const id = routeIdOf(found.legs);
    if (bases.has(id)) continue;
    bases.set(id, found);
    for (const e of edgeKeys(found.legs)) {
      queue.push(new Set([...ban, e]));
    }
  }
  return [...bases.values()];
}
