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
 * Temperature is °C and solar irradiance is kWh/m²/day; every other factor is
 * a 0–100 index. Missing values are shown explicitly instead of becoming zero.
 */
export function fmt(key, value) {
  const number = numeric(value);
  if (number == null) return 'no data';
  if (key === 'temp') {
    return (number < 0 ? MINUS : '') + Math.abs(number) + ' °C';
  }
  if (key === 'solar') {
    return (number < 0 ? MINUS : '') + Math.abs(number).toFixed(1) + ' kWh/m²/day';
  }
  return number + ' / 100';
}

/** Uncertainty in the same unit as the factor. */
export function fmtUncertainty(key, measurement) {
  const sigma = typeof measurement === 'number'
    ? measurement
    : measurement && typeof measurement.uncertainty === 'number'
      ? measurement.uncertainty
      : null;
  if (sigma == null || !Number.isFinite(sigma)) return '';
  if (key === 'temp') return '±' + sigma + ' °C';
  if (key === 'solar') return '±' + sigma.toFixed(1) + ' kWh/m²/day';
  return '±' + sigma + ' index';
}

/** Coordinates in a compact, copy-paste friendly form. */
export function fmtCoords(lat, lon) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return '';
  const ns = lat >= 0 ? 'N' : 'S';
  const ew = lon >= 0 ? 'E' : 'W';
  return Math.abs(lat).toFixed(1) + '°' + ns + ' ' + Math.abs(lon).toFixed(1) + '°' + ew;
}

/** Round a score and append a percent sign. */
export const pct = (value) => Math.round(value) + '%';
