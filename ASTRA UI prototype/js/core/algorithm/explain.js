import { confidenceLabel } from './confidence.js';
import { round, safeDiv } from './normalize.js';

/**
 * Deterministic explanations generated from the actual score components.
 * No random text and no claim that goes beyond the measurements.
 */

/** Features that contributed most to the normalized distance. */
export function driverList(parts, limit = 3) {
  const totalWeight = parts.reduce(
    (sum, part) => sum + (part.valid ? part.wt : 0),
    0
  );

  return parts
    .filter((part) => part.valid && part.wt > 0)
    .map((part) => ({
      key: part.f.k,
      label: part.f.label,
      target: part.t,
      candidate: part.a,
      similarity: part.sim,
      distance: part.d,
      weight: part.wt,
      weightShare: round(safeDiv(part.wt, totalWeight), 3),
      distanceShare: round(safeDiv(part.d * part.wt, totalWeight), 3),
      comparability: part.comparability,
      note: part.note
    }))
    .sort((a, b) => b.distanceShare - a.distanceShare)
    .slice(0, limit);
}

export function buildExplanation({
  target,
  analog,
  total,
  coverage,
  confidence,
  parts,
  status
}) {
  const comparable = parts.filter((part) => part.valid && part.wt > 0);
  const name = analog?.name ?? 'This Earth site';
  const targetName = target?.name ?? 'the target';

  if (!comparable.length) {
    return `${name} has no comparable measurements for ${targetName}, so no similarity ` +
      'score can be supported by the selected features.';
  }

  const best = [...comparable].sort((a, b) => a.d - b.d)[0];
  const worst = [...comparable].sort((a, b) => b.d - a.d)[0];
  const coveragePercent = Math.round(coverage * 100);
  const label = confidenceLabel(confidence);
  const provisional = status === 'ok' ? '' : ' Treat this as provisional because data coverage is limited.';

  const prefix = total >= 80
    ? 'Strong resemblance'
    : total >= 65
      ? 'Good resemblance'
      : total >= 50
        ? 'Partial resemblance'
        : 'Weak resemblance';

  return `${prefix}: ${name} scores ${Math.round(total)}% against ${targetName}. ` +
    `Closest agreement is ${best.f.label.toLowerCase()} (${Math.round(best.sim)}% similarity); ` +
    `the largest gap is ${worst.f.label.toLowerCase()} (${Math.round(worst.sim)}%). ` +
    `Coverage is ${coveragePercent}% of the requested weight and confidence is ` +
    `${Math.round(confidence)}% (${label}).${provisional}`;
}

export function buildWarnings({
  parts,
  coverage,
  minCoverage,
  target,
  analog,
  status,
  profileId,
  anyWeight
}) {
  const warnings = [];
  const coveragePercent = Math.round(coverage * 100);
  const minimumPercent = Math.round(minCoverage * 100);

  if (!anyWeight) {
    warnings.push('No feature weights are above zero, so no weighted similarity can be computed.');
  }

  if (anyWeight && coverage < minCoverage) {
    warnings.push(
      `Data coverage is ${coveragePercent}%, below the ${minimumPercent}% minimum. ` +
      'The score is computed from the available features but should be treated as provisional.'
    );
  }

  const missing = parts.filter(
    (part) => part.applicable && !part.valid && part.wtRequested > 0
  );
  if (missing.length) {
    warnings.push(
      'Missing or invalid data excluded from the score: ' +
      missing.map((part) => part.f.label).join(', ') +
      '. Weights were renormalised over the remaining features.'
    );
  }

  const tube = parts.find((part) => part.f.k === 'tube');
  if (tube && !tube.applicable && tube.reason === 'not_applicable') {
    warnings.push(
      'Lava-tube access was not used because the selected target has no mapped tube or pit.'
    );
  }

  if (target?.conf === 'Low' || analog?.conf === 'Low') {
    warnings.push(
      'One or both sites have low documentation confidence. Confidence is reported ' +
      'separately and is reduced accordingly.'
    );
  }

  const proxies = parts.filter(
    (part) => part.valid && part.f.evidenceType === 'proxy'
  );
  if (proxies.length) {
    warnings.push(
      'Proxy features (' + proxies.map((part) => part.f.label).join(', ') +
      ') are compared as documented evidence indexes. They are not identical ' +
      'measurements across Earth, the Moon and Mars.'
    );
  }

  if (profileId === 'balanced_overall' || profileId === 'custom') {
    warnings.push(
      'Similarity is relative to the selected features and weights. It is not a ' +
      'validated measure of habitability, resource availability or mission suitability.'
    );
  }

  if (status === 'insufficient_features') {
    warnings.push('Fewer than the minimum number of comparable features were available.');
  }

  return [...new Set(warnings)];
}
