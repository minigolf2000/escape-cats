// Deterministic randomness so every phone renders the identical mouse-toy
// animation from just (seed, toyCount, synced clock) — no position traffic.

/** mulberry32 PRNG: tiny, fast, deterministic across JS engines. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * TODO(reveal-mechanic): letter-stroke waypoints. Each toy gets assigned a
 * fragment of a letter stroke of the code word; early toys walk noisy,
 * mostly-random paths, and as toyCount approaches
 * HEX_BALANCE.toysForLegibleWord the noise decays and stroke coverage grows
 * until the word snaps into legibility. The interface below is what the
 * client animation layer codes against today.
 */
export interface ToyPathPoint {
  x: number; // 0..1 normalized screen space
  y: number;
}

export function toyPathAt(
  seed: number,
  toyIndex: number,
  timeMs: number,
): ToyPathPoint {
  // Placeholder: seeded wandering lissajous-ish loops, unique per toy.
  const rng = mulberry32(seed + toyIndex * 7919);
  const cx = 0.15 + rng() * 0.7;
  const cy = 0.15 + rng() * 0.7;
  const rx = 0.05 + rng() * 0.15;
  const ry = 0.05 + rng() * 0.15;
  const speed = 0.0002 + rng() * 0.0004;
  const phase = rng() * Math.PI * 2;
  const wobble = 2 + Math.floor(rng() * 3);
  const t = timeMs * speed + phase;
  return {
    x: cx + Math.cos(t) * rx,
    y: cy + Math.sin(t * wobble) * ry,
  };
}
