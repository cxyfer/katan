/**
 * Randomness seam. The rules engine never draws randomness itself: callers pass
 * an `Rng`, and every drawn outcome is stored in the resulting snapshot so a
 * game can be recovered deterministically without replaying the draw.
 */

export interface Rng {
  /** Uniform integer in [0, maxExclusive). */
  int(maxExclusive: number): number;
}

/** Deterministic generator for fixtures and property tests. */
export function seededRng(seed: number): Rng {
  let a = seed >>> 0;
  return {
    int(maxExclusive: number): number {
      if (maxExclusive <= 0) throw new Error('maxExclusive must be positive');
      const limit = Math.floor(0x100000000 / maxExclusive) * maxExclusive;
      for (;;) {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        const value = (t ^ (t >>> 14)) >>> 0;
        if (value < limit) return value % maxExclusive;
      }
    },
  };
}

interface CryptoLike {
  getRandomValues<T extends ArrayBufferView>(array: T): T;
}

/** Cryptographically strong generator used by the live service. */
export function secureRng(): Rng {
  const source = (globalThis as unknown as { crypto?: CryptoLike }).crypto;
  if (!source) throw new Error('no cryptographic source available');
  return {
    int(maxExclusive: number): number {
      if (maxExclusive <= 0) throw new Error('maxExclusive must be positive');
      const limit = Math.floor(0x100000000 / maxExclusive) * maxExclusive;
      const buf = new Uint32Array(1);
      for (;;) {
        source.getRandomValues(buf);
        const value = buf[0]!;
        if (value < limit) return value % maxExclusive;
      }
    },
  };
}

/** Fisher-Yates shuffle returning a new array. */
export function shuffle<T>(items: readonly T[], rng: Rng): T[] {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    const tmp = out[i]!;
    out[i] = out[j]!;
    out[j] = tmp;
  }
  return out;
}
