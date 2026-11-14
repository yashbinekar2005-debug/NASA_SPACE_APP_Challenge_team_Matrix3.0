import { rankAnalogs } from './algorithm/engine.js';

const MCD_SOURCE = 'mars-climate-database-6.2';

/** Validate a live MCD response before it can become a scoreable target. */
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

/** Score a point only when its current-execution planetary measurements validate. */
export function rankMeasuredMarsPoint(target, candidates, weights) {
  if (!target || target.body !== 'mars' || !target.custom || target.measurementStatus !== 'validated') return [];
  if (!validateMarsPointResponse(target.measurements).valid) return [];
  const currentValues = target.measurements.values;
  if (target.v?.temp?.value !== currentValues.temp.value || target.v?.solar?.value !== currentValues.solar.value) return [];
  return rankAnalogs(target, candidates, weights).filter((result) => result.matchedFeatures.length > 0);
}
