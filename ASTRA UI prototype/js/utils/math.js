// Shared math used by the globe, terrain and texture renderers.

export const TAU = Math.PI * 2;
export const D2R = Math.PI / 180;
export const INV_TAU = 1 / TAU;

/** Clamp a value into [lo, hi]. */
export const clamp = (value, lo, hi) => Math.max(lo, Math.min(hi, value));

/** Wrap an angle into [-π, π]. */
export function shortest(delta) {
  while (delta > Math.PI) delta -= TAU;
  while (delta < -Math.PI) delta += TAU;
  return delta;
}

/** Hermite smoothstep between two edges. */
export function smooth(edge0, edge1, x) {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}
