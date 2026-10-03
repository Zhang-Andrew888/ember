/** 32-bit string hash (FNV-1a with a murmur-style finalizer). */
export function hashString(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/** Deterministic mulberry32 generator. Same seed gives the same sequence everywhere. */
export class Rng {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  range(min: number, max: number): number {
    return min + (max - min) * this.next();
  }

  int(minInclusive: number, maxInclusive: number): number {
    return minInclusive + Math.floor(this.next() * (maxInclusive - minInclusive + 1));
  }
}

/**
 * Stateless uniform [0, 1) draw from a seed and three integer keys. Unlike a stream, the value depends
 * only on its inputs, so fire steps stay reproducible however many times they are cloned or replayed.
 */
export function unitHash(seed: number, a: number, b: number, salt: number): number {
  let h = (seed ^ Math.imul(a + 0x7f4a7c15, 0x9e3779b1)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = (h ^ Math.imul(b + 0x165667b1, 0xc2b2ae35)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0x27d4eb2f);
  h = (h ^ Math.imul(salt + 0x1b873593, 0x9e3779b1)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
}

/**
 * Independent random stream for one purpose ("world", "forecast", "cosmetic", ...).
 * Streams derived from the same root seed never share state.
 */
export function streamRng(rootSeed: string, label: string): Rng {
  return new Rng(hashString(`${rootSeed}\u0000${label}`));
}

export { canonicalJson, hashText, hashValue } from "@ember/knowledge";
