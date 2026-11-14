import { isFiniteNumber, quantileSeries } from './normalize.js';

/**
 * Normalise one stored feature value without losing its measurement context.
 *
 * A site value may be:
 *   - a number:             v: { temp: -20 }
 *   - a measurement object: v: { temp: { value: -20, uncertainty: 2, source: '…' } }
 *   - a distribution:       v: { temp: { quantiles: { p10: -30, p50: -20, p90: -10 } } }
 *   - an evidence class:    v: { ice: { value: 70, evidenceClass: 2 } }
 *   - missing:              v: { temp: null } or the key omitted
 *
 * The original raw object is preserved so provenance and uncertainty can be
 * reported by the API without the engine inventing values.
 */
export function readMeasurement(site, key) {
  const raw = site && site.v ? site.v[key] : undefined;
  const empty = {
    raw,
    value: null,
    quantiles: null,
    evidenceClass: null,
    uncertainty: null,
    source: null,
    measurementType: null,
    valid: false
  };

  if (raw == null) return empty;

  if (typeof raw === 'number') {
    return { ...empty, value: raw, valid: Number.isFinite(raw) };
  }

  if (typeof raw === 'object') {
    const value = firstFinite(raw.value, raw.median, raw.mean);
    const quantilesRaw = raw.quantiles ?? raw.distribution ?? null;
    const quantiles = quantileSeries(quantilesRaw);
    const evidenceClass = firstFinite(
      raw.evidenceClass,
      raw.evidence_class,
      raw.evidence
    );

    return {
      raw,
      value,
      quantiles: quantiles ? quantilesRaw : null,
      evidenceClass,
      uncertainty: raw.uncertainty ?? raw.error ?? null,
      source: raw.source ?? raw.sourceDataset ?? raw.source_dataset ?? null,
      measurementType: raw.measurementType ?? raw.measurement_type ?? null,
      valid: value != null || quantiles != null || evidenceClass != null
    };
  }

  return empty;
}

function firstFinite(...values) {
  for (const value of values) {
    if (isFiniteNumber(value)) return value;
  }
  return null;
}

/** Can this pair be compared using ordered evidence classes? */
export function comparableEvidence(targetMeasurement, candidateMeasurement) {
  return isFiniteNumber(targetMeasurement.evidenceClass) &&
    isFiniteNumber(candidateMeasurement.evidenceClass);
}
