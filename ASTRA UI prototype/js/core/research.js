import { rankAnalogs } from './algorithm/engine.js';
import { FACTORS } from '../data/factors.js';

/**
 * Scientific-data gates for live point probes.
 *
 * A coordinate result may only become a scoreable target when the payload
 * proves where every number came from. These validators do not judge whether
 * an analog is good: they only reject payloads that are incomplete, stale,
 * out of physical range, or missing provenance.
 */

const PROBE_SCHEMA = 'astra.planetary-probe/1';

const BODY_RULES = Object.freeze({
  moon: {
    dataset: 'NASA Moon Trek point probe',
    probeSource: 'astra-moon-point-probe',
    allowedSources: new Set([
      'lro-lola-dem-256ppd',
      'lro-diviner-hourly',
      'kaguya-mi-feo',
      'nasa-moon-solar-constant',
      'nasa-moon-fact-sheet'
    ]),
    tempSource: 'lro-diviner-hourly',
    tempSamples: { pattern: /^(\d+)\/8 local-hour samples$/, minimum: 3 }
  },
  mars: {
    dataset: 'NASA Mars Trek + Mars Climate Database point probe',
    probeSource: 'astra-mars-point-probe',
    allowedSources: new Set([
      'mars-mola-128-64',
      'usgs-sim3292-geology',
      'mars-climate-database-6.2',
      'mars-climate-database-solar',
      'mars-climate-database-water',
      'mars-climate-database-vapour'
    ]),
    tempSource: 'mars-climate-database-6.2',
    tempSamples: { pattern: /^(\d+)\/25 seasonal samples$/, minimum: 12 }
  }
});

const VALUE_RANGES = Object.freeze({
  temp: { min: -150, max: 60, unit: '°C' },
  solar: { min: 0, max: 20, unit: 'kWh/m²/day' },
  ice: { min: 0, max: 100, unit: 'index' },
  soil: { min: 0, max: 100, unit: 'index' },
  terrain: { min: 0, max: 100, unit: 'index' },
  dry: { min: 0, max: 100, unit: 'index' },
  tube: { min: 0, max: 100, unit: 'index' },
  pressureKpa: { min: 0, max: 2, unit: 'kPa' }
});

const FACTOR_KEYS = new Set(FACTORS.map((factor) => factor.k));

/** Validate a live Moon or Mars probe payload before it can be scored. */
export function validatePointProbe(payload, body = payload?.body) {
  const rules = BODY_RULES[body];
  const source = payload?.source;
  const values = payload?.values;
  const completeness = payload?.completeness;
  const checks = {
    schema: payload?.schema === PROBE_SCHEMA,
    body: Boolean(rules) && payload?.body === body,
    coordinate: Number.isFinite(payload?.lat) && payload.lat >= -90 && payload.lat <= 90 &&
      Number.isFinite(payload?.lon) && payload.lon >= -180 && payload.lon <= 180,
    dataset: Boolean(rules) && payload?.dataset === rules.dataset,
    source: Boolean(rules) && source?.id === rules.probeSource &&
      typeof source?.name === 'string' && /^https:\/\//.test(source?.url || '') &&
      typeof source?.evidenceType === 'string' &&
      validDate(payload?.retrievedAt),
    completeness: completeness && typeof completeness === 'object',
    features: false,
    provenance: false,
    samples: false
  };
  if (!rules || !values || typeof values !== 'object' || !checks.completeness) {
    return { valid: false, body, checks, errors: ['Malformed probe payload'] };
  }

  const errors = [];
  const present = [];
  for (const [key, measured] of Object.entries(values)) {
    if (measured == null) continue;
    const spec = VALUE_RANGES[key];
    if (!spec) {
      errors.push(`Unknown feature "${key}"`);
      continue;
    }
    if (!Number.isFinite(measured.value) || measured.value < spec.min || measured.value > spec.max) {
      errors.push(`${key} value is outside ${spec.min}–${spec.max} ${spec.unit}`);
    }
    if (measured.unit !== spec.unit) errors.push(`${key} unit ${measured.unit || '(missing)'} does not match ${spec.unit}`);
    if (!Number.isFinite(measured.uncertainty) || measured.uncertainty < 0) {
      errors.push(`${key} uncertainty is missing or negative`);
    }
    const measuredSource = measured.source;
    if (!measuredSource?.id || !rules.allowedSources.has(measuredSource.id)) {
      errors.push(`${key} source "${measuredSource?.id || 'missing'}" is not an approved ${body} product`);
    }
    if (!/^https:\/\//.test(measuredSource?.url || '')) errors.push(`${key} source URL is not HTTPS`);
    const completenessKey = key === 'pressureKpa' ? 'pressure' : key;
    if (typeof completeness[completenessKey] !== 'string' || !completeness[completenessKey]) {
      errors.push(`${key} has no completeness entry`);
    } else if (/^(unavailable|not queried)/i.test(completeness[completenessKey])) {
      errors.push(`${key} is present while completeness says "${completeness[completenessKey]}"`);
    }
    if (FACTOR_KEYS.has(key)) present.push(key);
  }

  checks.features = present.length >= 2;
  if (!checks.features) errors.push('Fewer than two scoreable features');

  checks.provenance = Array.isArray(payload.sources) && payload.sources.length > 0 &&
    payload.sources.every((entry) => typeof entry?.id === 'string' && rules.allowedSources.has(entry.id) &&
      /^https:\/\//.test(entry?.url || ''));
  if (!checks.provenance) errors.push('Source list is missing or contains an unapproved product');

  const temp = values.temp;
  if (temp) {
    const samples = Number(String(completeness.temp || '').match(rules.tempSamples.pattern)?.[1]);
    checks.samples = temp.source?.id === rules.tempSource &&
      Number.isFinite(samples) && samples >= rules.tempSamples.minimum;
    if (!checks.samples) errors.push(`${body} temperature lacks the required seasonal or hourly samples`);
  } else {
    checks.samples = true;
  }

  const reported = new Set(Array.isArray(payload.presentFeatures) ? payload.presentFeatures : []);
  if (present.some((key) => !reported.has(key))) errors.push('presentFeatures does not match values');

  return {
    valid: Object.values(checks).every(Boolean) && errors.length === 0,
    body,
    checks,
    errors
  };
}

/**
 * Score a live point only when the probe payload is valid, belongs to the
 * current target and still matches the values copied into `target.v`.
 */
export function rankMeasuredPoint(target, candidates, weights) {
  if (!target || !target.custom || !['moon', 'mars'].includes(target.body)) return [];
  if (target.measurementStatus !== 'validated') return [];
  const measurements = target.measurements;
  const validation = validatePointProbe(measurements, target.body);
  if (!validation.valid) return [];
  if (Math.abs(Number(measurements.lat) - Number(target.lat)) > 1e-6) return [];
  if (Math.abs(Number(measurements.lon) - Number(target.lon)) > 1e-6) return [];

  const values = measurements.values;
  const present = FACTORS.map((factor) => factor.k)
    .filter((key) => values[key] && Number.isFinite(values[key].value));
  if (!present.length) return [];
  const fresh = present.every((key) => target.v?.[key]?.value === values[key].value);
  if (!fresh) return [];

  return rankAnalogs(target, candidates, weights).filter((result) => result.matchedFeatures.length > 0);
}

/** Validate an Earth POWER point against its current coordinate and source metadata. */
export function validateEarthPointResponse(payload, lat, lon) {
  const source = payload?.source;
  const features = payload?.features;
  const allowed = new Set(['nasa-power-ts', 'nasa-power-solar', 'nasa-power-water', 'nasa-power-dryness']);
  const sourceOk = payload?.dataset === 'NASA POWER / MERRA-2' &&
    source?.name === 'NASA POWER / MERRA-2 climatology' &&
    source?.url === 'https://power.larc.nasa.gov/' &&
    /^https:\/\/power\.larc\.nasa\.gov\/api\/temporal\/climatology\/point\?/.test(source?.reference || '') &&
    source?.observationPeriod === '2001-2025' &&
    typeof source?.resolution === 'string' && /0\.5/.test(source.resolution) &&
    validDate(payload?.retrievedAt);
  const coordinateOk = Number.isFinite(lat) && Number.isFinite(lon) &&
    payload?.coordinate?.latitude === lat && payload?.coordinate?.longitude === lon;
  let validFeatures = 0;
  const featureErrors = [];
  if (!features || typeof features !== 'object') featureErrors.push('Features are missing');
  else for (const [key, item] of Object.entries(features)) {
    if (item == null) continue;
    const spec = VALUE_RANGES[key];
    const id = item?.source?.id;
    if (!spec || !Number.isFinite(item.value) || item.value < spec.min || item.value > spec.max ||
      item.unit !== spec.unit || !Number.isFinite(item.uncertainty) || item.uncertainty < 0 ||
      !allowed.has(id) || !/^https:\/\/power\.larc\.nasa\.gov\//.test(item.source?.url || '') ||
      payload.completeness?.[key] !== 'measured') {
      featureErrors.push(`${key} is missing valid NASA POWER measurement metadata`);
      continue;
    }
    validFeatures += 1;
  }
  if (validFeatures < 2) featureErrors.push('Fewer than two validated measured features');
  return {
    valid: sourceOk && coordinateOk && featureErrors.length === 0,
    checks: { source: sourceOk, coordinate: coordinateOk, features: featureErrors.length === 0 },
    errors: featureErrors.concat(!sourceOk ? ['NASA POWER provenance or retrieval period is invalid'] : [], !coordinateOk ? ['NASA POWER payload does not match the selected coordinates'] : [])
  };
}

/** Rank only the currently selected validated Earth point against the chosen planet target. */
export function rankMeasuredEarthPoint(target, point, weights) {
  if (!target || !['moon', 'mars'].includes(target.body) || !point?.custom || point.body !== 'earth' ||
    point.measurementStatus !== 'validated' || !Number.isFinite(point.lat) || !Number.isFinite(point.lon)) return [];
  if (!validateEarthPointResponse(point.measurements, point.lat, point.lon).valid) return [];
  const payloadFeatures = point.measurements.features;
  const present = Object.keys(payloadFeatures).filter((key) => payloadFeatures[key] && Number.isFinite(payloadFeatures[key].value));
  if (!present.length || present.some((key) => point.v?.[key]?.value !== payloadFeatures[key].value)) return [];
  if (target.custom) {
    const validation = validatePointProbe(target.measurements, target.body);
    if (!validation.valid || target.measurementStatus !== 'validated' ||
      Math.abs(target.measurements.lat - target.lat) > 1e-6 || Math.abs(target.measurements.lon - target.lon) > 1e-6) return [];
  }
  return rankAnalogs(target, [point], weights).filter((result) => result.matchedFeatures.length > 0);
}

/* ------------------------------------------------------------------ */
/* Mars Climate Database compatibility gate (legacy /api/mars-point)   */
/* ------------------------------------------------------------------ */

const MCD_SOURCE = 'mars-climate-database-6.2';

/**
 * Validate the older MCD-only response shape. The UI no longer uses this
 * route, but it stays exported so existing integrations keep working.
 */
export function validateMarsPointResponse(payload) {
  const source = payload?.source;
  const values = payload?.values;
  const officialReference = typeof source?.reference === 'string' &&
    /^https:\/\/www-mars\.lmd\.jussieu\.fr\/mcd_python\/txt\/[a-f0-9]+\.txt$/i.test(source.reference);
  const sourceOk = payload?.dataset === 'Mars Climate Database v6.2' &&
    source?.id === MCD_SOURCE && source?.evidenceType === 'modelled_climatology' &&
    source?.url === 'https://www-mars.lmd.jussieu.fr/mars/access' && officialReference &&
    typeof source.period === 'string' && typeof source.resolution === 'string';
  const parameterSpecs = {
    temp: { min: -150, max: 60, unit: '°C' },
    solar: { min: 0, max: 20, unit: 'kWh/m²/day' },
    pressureKpa: { min: 0, max: 2, unit: 'kPa' }
  };
  const parametersOk = Object.entries(parameterSpecs).every(([key, spec]) => {
    const measured = values?.[key];
    const n = measured?.value;
    const samples = Number(String(payload?.completeness?.[key === 'pressureKpa' ? 'pressure' : key] || '').match(/^(\d+)\/(\d+)/)?.[1]);
    return measured?.source?.id === MCD_SOURCE && measured.unit === spec.unit &&
      Number.isFinite(n) && n > spec.min && n < spec.max &&
      Number.isFinite(measured.seasonalSpread) && measured.seasonalSpread >= 0 &&
      Number.isFinite(samples) && samples >= 12 && samples <= 25;
  });
  return { valid: sourceOk && parametersOk, sourceOk, parametersOk };
}

/** Legacy Mars-only ranking kept for the old MCD response shape. */
export function rankMeasuredMarsPoint(target, candidates, weights) {
  if (!target || target.body !== 'mars' || !target.custom || target.measurementStatus !== 'validated') return [];
  if (!validateMarsPointResponse(target.measurements).valid) return [];
  const currentValues = target.measurements.values;
  if (target.v?.temp?.value !== currentValues.temp.value || target.v?.solar?.value !== currentValues.solar.value) return [];
  return rankAnalogs(target, candidates, weights).filter((result) => result.matchedFeatures.length > 0);
}

function validDate(value) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}
