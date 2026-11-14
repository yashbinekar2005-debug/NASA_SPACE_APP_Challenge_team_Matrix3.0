/**
 * Small, dependency-free numeric helpers used by the similarity engine.
 * Keeping them here makes the formulas testable without geospatial libraries.
 */

export const isFiniteNumber = (value) =>
  typeof value === 'number' && Number.isFinite(value);

export const clamp = (value, min, max) =>
  Math.min(max, Math.max(min, value));

export const clamp01 = (value) => clamp(value, 0, 1);

export const round = (value, digits = 2) => {
  if (!isFiniteNumber(value)) return value;
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
};

export function safeDiv(numerator, denominator, fallback = 0) {
  return isFiniteNumber(denominator) && denominator !== 0
    ? numerator / denominator
    : fallback;
}

/** Temperature is stored and displayed in °C, but the engine documents Kelvin too. */
export const celsiusToKelvin = (celsius) => celsius + 273.15;
export const kelvinToCelsius = (kelvin) => kelvin - 273.15;

/**
 * Linear percentile of a numeric sample (0–1). Used for diagnostics and for
 * optional rank scaling of candidate distributions.
 */
export function quantile(values, p) {
  if (!Array.isArray(values) || !values.length) return null;
  const sorted = values.filter(isFiniteNumber).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const position = clamp01(p) * (sorted.length - 1);
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];
  const fraction = position - lower;
  return sorted[lower] * (1 - fraction) + sorted[upper] * fraction;
}

/**
 * Convert a distribution into an ordered quantile series.
 *
 * Accepted forms:
 *   - [p10, p50, p90]                    (array, assumed ordered)
 *   - { p10: …, p50: …, p90: … }         (object, any p## keys)
 *
 * Returns null when the distribution is not usable or the two sides do not
 * share the same probability levels (comparing mismatched quantiles would be
 * a fabricated distance).
 */
export function quantileSeries(distribution) {
  if (!distribution) return null;

  if (Array.isArray(distribution)) {
    const values = distribution.filter(isFiniteNumber);
    if (!values.length) return null;
    return { probs: values.map((_, index) => index), values };
  }

  if (typeof distribution === 'object') {
    const entries = Object.entries(distribution)
      .filter(([key, value]) => /^p\d+(?:\.\d+)?$/i.test(key) && isFiniteNumber(value))
      .sort((a, b) => Number(a[0].slice(1)) - Number(b[0].slice(1)));
    if (!entries.length) return null;
    return {
      probs: entries.map(([key]) => key.toLowerCase()),
      values: entries.map(([, value]) => value)
    };
  }

  return null;
}

/** Robust z-score, kept for future candidate normalization. */
export function robustZ(value, median, iqr) {
  if (!isFiniteNumber(value) || !isFiniteNumber(median) || !isFiniteNumber(iqr) || iqr === 0) {
    return null;
  }
  return (value - median) / iqr;
}

/** Rank of a value in a sample, in [0, 1]. Ties receive the same rank. */
export function percentileRank(value, values) {
  if (!isFiniteNumber(value) || !Array.isArray(values)) return null;
  const valid = values.filter(isFiniteNumber);
  if (!valid.length) return null;
  const below = valid.filter((candidate) => candidate < value).length;
  const equal = valid.filter((candidate) => candidate === value).length;
  return (below + Math.max(0, equal - 1) / 2) / Math.max(1, valid.length - 1);
}

/** Recursively key-sorted JSON, so fingerprints do not depend on key order. */
export function stableStringify(value) {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return '[' + value.map(stableStringify).join(',') + ']';
  }
  return '{' + Object.keys(value)
    .sort()
    .map((key) => JSON.stringify(key) + ':' + stableStringify(value[key]))
    .join(',') + '}';
}

/** FNV-1a 32-bit hash. Useful for a reproducible run/config fingerprint. */
export function hashString(text) {
  let hash = 0x811c9dc5;
  const input = String(text);
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export function fingerprint(value) {
  return hashString(stableStringify(value));
}
