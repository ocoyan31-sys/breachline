// Shared math: seeded RNG, scalar helpers, analytic segment-vs-AABB tests. The segment
// tests are the hot-path LOS primitive — no three.js raycasts, no allocations. Points are
// any {x,y,z}; boxes are any {min:{x,y,z}, max:{x,y,z}} (a THREE.Box3 qualifies).

export function mulberry32(seed) {
  let a = seed | 0;
  return function next() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
export function lerp(a, b, t) { return a + (b - a) * t; }
// Frame-rate independent exponential approach of b at rate lambda (1/s).
export function damp(a, b, lambda, dt) { return lerp(a, b, 1 - Math.exp(-lambda * dt)); }

const AXES = ['x', 'y', 'z'];

// Slab test: does segment a->b touch or cross the AABB? Touching a face counts.
export function segHitsBox(a, b, box) {
  let tLo = 0, tHi = 1;
  for (let i = 0; i < 3; i++) {
    const k = AXES[i], d = b[k] - a[k];
    if (d === 0) { if (a[k] < box.min[k] || a[k] > box.max[k]) return false; continue; }
    let t1 = (box.min[k] - a[k]) / d, t2 = (box.max[k] - a[k]) / d;
    if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
    if (t1 > tLo) tLo = t1;
    if (t2 < tHi) tHi = t2;
    if (tLo > tHi) return false;
  }
  return true;
}

// True when any collider blocks segment a->b (line-of-sight / bullet-cover tests).
export function segBlocked(a, b, colliders) {
  for (let i = 0; i < colliders.length; i++) if (segHitsBox(a, b, colliders[i])) return true;
  return false;
}
