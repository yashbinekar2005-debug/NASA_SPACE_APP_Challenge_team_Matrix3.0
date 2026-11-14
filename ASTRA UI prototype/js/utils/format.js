// Number and text formatting shared by the results list and compare screen.

/** Typographic minus so negative temperatures read correctly. */
export const MINUS = '−';

/** Unwrap a numeric value or a measurement object. */
function numeric(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (value && typeof value === 'object') {
    if (typeof value.value === 'number' && Number.isFinite(value.value)) return value.value;
    if (typeof value.median === 'number' && Number.isFinite(value.median)) return value.median;
    if (typeof value.mean === 'number' && Number.isFinite(value.mean)) return value.mean;
  }
  return null;
}

/**
 * Format a factor value for display.
 * Temperatures are real °C; every other factor is a 0–100 index.
 * Missing values are shown explicitly instead of becoming zero.
 */
export function fmt(key, value) {
  const number = numeric(value);
  if (number == null) return 'no data';
  return key === 'temp'
    ? (number < 0 ? MINUS : '') + Math.abs(number) + ' °C'
    : number + ' / 100';
}

/** Round a score and append a percent sign. */
export const pct = (value) => Math.round(value) + '%';
