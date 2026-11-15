import { FACTORS } from '../../data/factors.js';
import {
  CONFIG_VERSION,
  DEFAULTS,
  DEFAULT_PROFILE,
  ENGINE_VERSION,
  FEATURE_KEYS,
  PROFILE_DEFINITIONS,
  PROFILE_ORDER
} from './features.js';
import {
  capabilityDistance,
  evidenceClassDistance,
  featureDistance
} from './distance.js';
import { readMeasurement, comparableEvidence } from './measurement.js';
import {
  clamp,
  fingerprint,
  isFiniteNumber,
  round
} from './normalize.js';
import {
  confidenceLabel,
  confidenceOf,
  coverageOf
} from './confidence.js';
import { buildExplanation, buildWarnings, driverList } from './explain.js';
import { propagateUncertainty, certaintyLabel } from './uncertainty.js';
import { nonReplicableFor } from '../../data/planetary.js';

/**
 * Multi-criteria planetary analog similarity engine — version 1.
 *
 * For candidate j:
 *
 *   d_ij = bounded distance for feature i
 *   D_j  = Σ(w_i · d_ij) / Σ(w_i)      over valid, comparable features
 *   S_j  = 100 · (1 − D_j)
 *
 * Weights are relative importances. Missing/invalid features are excluded
 * from both the numerator and the denominator, and coverage is reported
 * separately. Nothing is silently replaced with zero.
 *
 * The engine is pure: the same target, candidate, weights and options always
 * produce the same result (see `fingerprint`).
 */

export function score(target, analog, weights, options = {}) {
  const explicitWeights = hasWeights(weights);
  const profileId = options.profile ?? (explicitWeights ? 'custom' : DEFAULT_PROFILE);
  const resolvedWeights = resolveWeights(weights, profileId);
  const minCoverage = options.minCoverage ?? DEFAULTS.minCoverage;
  const minFeatures = options.minFeatures ?? DEFAULTS.minFeatures;
  const tubeThreshold = options.tubeThreshold ?? DEFAULTS.tubeThreshold;

  const parts = FACTORS.map((feature) => {
    const targetMeasurement = readMeasurement(target, feature.k);
    const candidateMeasurement = readMeasurement(analog, feature.k);
    const requestedWeight = Math.max(0, toNumber(resolvedWeights[feature.k], 0));

    return buildPart({
      feature,
      targetMeasurement,
      candidateMeasurement,
      requestedWeight,
      tubeThreshold
    });
  });

  let weightedDistance = 0;
  let weightTotal = 0;

  for (const part of parts) {
    part.wt = part.applicable && part.valid ? part.wtRequested : 0;
    if (part.valid && part.wt > 0) {
      weightedDistance += part.d * part.wt;
      weightTotal += part.wt;
    }
  }

  const normalizedDistance = weightTotal > 0 ? weightedDistance / weightTotal : null;
  const total = normalizedDistance == null ? 0 : 100 * (1 - normalizedDistance);

  for (const part of parts) {
    part.weightShare = weightTotal > 0 ? round(part.wt / weightTotal, 4) : 0;
    part.contribution = part.valid && weightTotal > 0
      ? round((part.d * part.wt) / weightTotal, 4)
      : 0;
  }

  const coverage = coverageOf(parts);
  const anyWeight = parts.some((part) => part.applicable && part.wtRequested > 0);
  const validCount = parts.filter((part) => part.valid && part.wt > 0).length;
  const status = scoreStatus({
    anyWeight,
    weightTotal,
    coverage,
    validCount,
    minCoverage,
    minFeatures
  });

  const confidence = confidenceOf({ coverage, target, analog, parts });
  const uncertainty = propagateUncertainty(parts);
  const profiles = computeProfiles(parts, target, analog, {
    minCoverage,
    minFeatures
  });

  const warnings = buildWarnings({
    parts,
    coverage,
    minCoverage,
    target,
    analog,
    status,
    profileId,
    anyWeight
  });

  const explanation = buildExplanation({
    target,
    analog,
    total,
    coverage,
    confidence,
    parts,
    status
  });

  const matchedFeatures = parts
    .filter((part) => part.valid && part.wt > 0)
    .map((part) => part.f.k);
  const excludedFeatures = parts
    .filter((part) => part.applicable && !part.valid && part.wtRequested > 0)
    .map((part) => part.f.k);

  return {
    targetId: target?.id ?? null,
    analogId: analog?.id ?? null,
    engineVersion: ENGINE_VERSION,
    configVersion: CONFIG_VERSION,
    profile: profileId,
    total,
    normalizedDistance,
    coverage: round(coverage, 4),
    confidence,
    confidenceLabel: confidenceLabel(confidence),
    certainty: uncertainty.certainty,
    certaintyLabel: uncertainty.certaintyLabel,
    uncertainty,
    scoreInterval: uncertainty.interval95,
    nonReplicable: nonReplicableFor(target?.body),
    status,
    insufficientData: status !== 'ok',
    weights: resolvedWeights,
    parts,
    drivers: driverList(parts),
    matchedFeatures,
    excludedFeatures,
    profiles,
    warnings,
    explanation,
    fingerprint: fingerprint({
      engineVersion: ENGINE_VERSION,
      configVersion: CONFIG_VERSION,
      target: target?.id ?? null,
      analog: analog?.id ?? null,
      profile: profileId,
      weights: resolvedWeights
    })
  };
}

/** Score and sort every candidate. Deterministic tie-breaking. */
export function rankAnalogs(target, analogs, weights, options = {}) {
  return (analogs ?? [])
    .map((analog) => ({ analog, ...score(target, analog, weights, options) }))
    .sort(compareResults);
}

function compareResults(a, b) {
  if (b.total !== a.total) return b.total - a.total;
  if (b.confidence !== a.confidence) return b.confidence - a.confidence;
  return String(a.analog?.id ?? '').localeCompare(String(b.analog?.id ?? ''));
}

/**
 * Plan-shaped API response. This is the shape a FastAPI route can return
 * unchanged; the static UI can also display it.
 */
export function runSimilarity({
  target,
  candidates,
  weights = null,
  profile = null,
  topK = 20,
  minCoverage = DEFAULTS.minCoverage,
  minFeatures = DEFAULTS.minFeatures
} = {}) {
  if (!target) throw new Error('runSimilarity requires a target region.');
  if (!Array.isArray(candidates)) throw new Error('runSimilarity requires candidate regions.');

  const effectiveProfile = profile ?? (hasWeights(weights) ? 'custom' : DEFAULT_PROFILE);
  const options = { profile: effectiveProfile, minCoverage, minFeatures };
  const ranked = rankAnalogs(target, candidates, weights, options);
  const results = ranked.slice(0, Math.max(0, topK)).map((result, index) => ({
    rank: index + 1,
    earth_region_id: result.analog?.id ?? null,
    earth_region_name: result.analog?.name ?? null,
    earth_region: result.analog?.region ?? null,
    similarity: round(result.total, 1),
    score_interval_95: result.scoreInterval,
    score_sigma: result.uncertainty.sigma,
    certainty: result.certainty,
    certainty_label: result.certaintyLabel,
    data_coverage: result.coverage,
    confidence: result.confidence,
    confidence_label: result.confidenceLabel,
    status: result.status,
    matched_features: result.matchedFeatures,
    excluded_features: result.excludedFeatures,
    non_replicable: result.nonReplicable,
    explanation: result.explanation,
    profiles: result.profiles,
    feature_contributions: result.parts.map((part) => ({
      feature_id: part.f.k,
      label: part.f.label,
      target_value: part.t,
      candidate_value: part.a,
      unit: part.f.unit,
      similarity: part.valid ? part.sim : null,
      distance: part.d,
      weight: part.wt,
      weight_share: part.weightShare,
      distance_share: part.contribution,
      uncertainty_sigma_points: result.uncertainty.perFeature[part.f.k]?.sigma_points ?? null,
      comparability: part.comparability,
      evidence_class: {
        target: part.evidenceClassTarget,
        candidate: part.evidenceClassCandidate
      },
      valid: part.valid,
      reason: part.reason,
      note: part.note
    }))
  }));

  const warnings = [...new Set(ranked.flatMap((result) => result.warnings))];

  return {
    target_body: target.body ?? null,
    target_region_id: target.id ?? null,
    target_name: target.name ?? null,
    non_replicable_differences: nonReplicableFor(target.body),
    profile: effectiveProfile,
    engine_version: ENGINE_VERSION,
    config_version: CONFIG_VERSION,
    search_scope: {
      candidate_count: candidates.length,
      top_k: topK,
      min_coverage: minCoverage,
      min_features: minFeatures
    },
    results,
    warnings
  };
}

/**
 * Feature ablation for validation: recompute the ranking with one feature
 * removed at a time and report how much the top-k changes. This is a
 * diagnostic, not part of the UI ranking path.
 */
export function ablate(target, analogs, weights, options = {}) {
  const baseline = rankAnalogs(target, analogs, weights, options);
  const baselineById = new Map(baseline.map((result, index) => [
    result.analog.id,
    { result, rank: index + 1 }
  ]));

  const features = {};

  for (const feature of FACTORS) {
    const reducedWeights = { ...resolveWeights(weights, options.profile ?? 'custom') };
    reducedWeights[feature.k] = 0;
    const without = rankAnalogs(target, analogs, reducedWeights, {
      ...options,
      profile: 'custom'
    });

    const top1Changed = (without[0]?.analog.id ?? null) !== (baseline[0]?.analog.id ?? null);
    let absoluteDelta = 0;

    without.forEach((result) => {
      const before = baselineById.get(result.analog.id);
      if (before) absoluteDelta += Math.abs(result.total - before.result.total);
    });

    features[feature.k] = {
      label: feature.label,
      top1_changed: top1Changed,
      mean_abs_score_delta: round(absoluteDelta / Math.max(1, without.length), 2),
      top: without.slice(0, 5).map((result, index) => ({
        rank: index + 1,
        id: result.analog.id,
        name: result.analog.name,
        similarity: round(result.total, 1)
      }))
    };
  }

  return {
    baseline: baseline.slice(0, 5).map((result, index) => ({
      rank: index + 1,
      id: result.analog.id,
      name: result.analog.name,
      similarity: round(result.total, 1)
    })),
    features,
    engine_version: ENGINE_VERSION,
    config_version: CONFIG_VERSION
  };
}

/** Human label for a 0–100 match score (kept from the prototype). */
export function tier(value) {
  return value >= 80
    ? 'Strong match'
    : value >= 65
      ? 'Good match'
      : value >= 50
        ? 'Partial match'
        : 'Weak match';
}

/* ------------------------------------------------------------------ */
/* Internals                                                          */
/* ------------------------------------------------------------------ */

function buildPart({
  feature,
  targetMeasurement,
  candidateMeasurement,
  requestedWeight,
  tubeThreshold
}) {
  const isCapability = feature.kind === 'capability';
  const capabilityKnown = isFiniteNumber(targetMeasurement.value);
  const hasTarget = targetMeasurement.valid;
  const hasCandidate = candidateMeasurement.valid;
  const compatible = compatibleMeasurements(feature.k, targetMeasurement, candidateMeasurement);
  const evidenceComparable = !isCapability &&
    feature.evidenceType === 'proxy' &&
    comparableEvidence(targetMeasurement, candidateMeasurement);

  let applicable = true;
  let reason = null;

  if (isCapability) {
    if (!capabilityKnown) {
      applicable = false;
      reason = 'missing_target';
    } else if (targetMeasurement.value < tubeThreshold) {
      applicable = false;
      reason = 'not_applicable';
    }
  }

  let distance = null;
  let note = feature.comparabilityNote ?? null;

  if (!isCapability && hasTarget && hasCandidate && !compatible.ok) {
    reason = 'incompatible_measurements';
    note = compatible.note;
  }

  if (applicable) {
    if (isCapability) {
      distance = capabilityDistance(
        candidateMeasurement.value,
        feature.scale ?? 100
      );
    } else if (!compatible.ok) {
      // Keep the requested weight in coverage, but exclude it from the score.
    } else if (evidenceComparable) {
      distance = evidenceClassDistance(
        targetMeasurement.evidenceClass,
        candidateMeasurement.evidenceClass,
        3
      );
      note = 'Compared as ordered evidence classes (0 none … 3 strong), not as a water fraction.';
    } else if (hasTarget && hasCandidate && compatible.ok) {
      distance = featureDistance(feature, targetMeasurement, candidateMeasurement);
    }
  }

  const valid = applicable && distance != null;
  if (applicable && !valid && compatible.ok) {
    reason = 'missing_data';
    if (!hasTarget && !hasCandidate) {
      note = 'No target or candidate measurement was available for this feature.';
    } else if (!hasTarget) {
      note = 'The target region has no valid measurement for this feature.';
    } else if (!hasCandidate) {
      note = 'The Earth candidate has no valid measurement for this feature.';
    }
  }

  return {
    f: feature,
    t: targetMeasurement.value,
    a: candidateMeasurement.value,
    sim: valid ? round(100 * (1 - distance), 1) : 0,
    wt: 0, // filled after all parts are known
    wtRequested: requestedWeight,
    na: !valid,
    valid,
    applicable,
    d: valid ? round(distance, 5) : null,
    weightShare: 0,
    contribution: 0,
    reason,
    note,
    comparability: feature.comparability,
    evidenceBasis: Boolean(evidenceComparable),
    evidenceClassTarget: targetMeasurement.evidenceClass,
    evidenceClassCandidate: candidateMeasurement.evidenceClass,
    targetUncertainty: targetMeasurement.uncertainty,
    candidateUncertainty: candidateMeasurement.uncertainty,
    targetEvidenceClassUncertainty: targetMeasurement.evidenceClassUncertainty,
    candidateEvidenceClassUncertainty: candidateMeasurement.evidenceClassUncertainty,
    distributionUsed: Boolean(targetMeasurement.quantiles && candidateMeasurement.quantiles),
    targetRaw: targetMeasurement.raw,
    candidateRaw: candidateMeasurement.raw
  };
}

// Index values are not interchangeable just because both are scaled 0–100.
// In particular, atmospheric water vapour, vacuum, and Earth precipitation / RH
// are different observations. Direct continuous quantities remain comparable
// through the factor's documented caveats and common units.
function compatibleMeasurements(key, target, candidate) {
  if (!target.valid || !candidate.valid) return { ok: true };
  if (['temp', 'solar'].includes(key)) return { ok: true };
  const targetType = target.measurementType;
  const candidateType = candidate.measurementType;
  // Untyped numeric values are supported by the pure mathematical API and the
  // legacy fixtures. Research entry points validate provenance before scoring;
  // whenever measurement types are supplied, they must agree exactly.
  if (!targetType || !candidateType) return { ok: true };
  if (targetType !== candidateType) {
    return {
      ok: false,
      note: `Excluded: incompatible evidence types (${targetType || 'unspecified'} vs ${candidateType || 'unspecified'}).`
    };
  }
  return { ok: true };
}

function computeProfiles(parts, target, analog, { minCoverage, minFeatures }) {
  const profiles = {};

  for (const id of PROFILE_ORDER) {
    const definition = PROFILE_DEFINITIONS[id];
    if (!definition) continue;

    let weightedDistance = 0;
    let weightTotal = 0;
    let requested = 0;
    let validWeight = 0;
    const features = [];

    for (const part of parts) {
      const weight = Math.max(0, toNumber(definition.weights[part.f.k], 0));
      if (!part.applicable || weight <= 0) continue;
      requested += weight;
      if (!part.valid) continue;

      validWeight += weight;
      weightedDistance += part.d * weight;
      weightTotal += weight;
      features.push(part.f.k);
    }

    const scoreValue = weightTotal > 0
      ? 100 * (1 - weightedDistance / weightTotal)
      : null;
    const coverage = requested > 0 ? validWeight / requested : 0;
    const confidence = confidenceOf({
      coverage,
      target,
      analog,
      parts,
      weightOf: (part) => Math.max(0, toNumber(definition.weights[part.f.k], 0))
    });

    profiles[id] = {
      id,
      label: definition.label,
      description: definition.description,
      caveat: definition.caveat,
      score: scoreValue == null ? null : round(scoreValue, 1),
      coverage: round(coverage, 4),
      confidence,
      confidenceLabel: confidenceLabel(confidence),
      status: !weightTotal
        ? 'no_comparable_features'
        : coverage < minCoverage
          ? 'insufficient_coverage'
          : features.length < minFeatures
            ? 'insufficient_features'
            : 'ok',
      features
    };
  }

  return profiles;
}

function scoreStatus({ anyWeight, weightTotal, coverage, validCount, minCoverage, minFeatures }) {
  if (!anyWeight) return 'no_weights';
  if (!weightTotal) return 'no_comparable_features';
  if (coverage < minCoverage) return 'insufficient_coverage';
  if (validCount < minFeatures) return 'insufficient_features';
  return 'ok';
}

function hasWeights(weights) {
  return weights != null && typeof weights === 'object' &&
    Object.keys(weights).length > 0;
}

function resolveWeights(weights, profileId) {
  if (hasWeights(weights)) {
    const resolved = {};
    for (const key of FEATURE_KEYS) {
      resolved[key] = Math.max(0, toNumber(weights[key], 0));
    }
    return resolved;
  }

  const profile = PROFILE_DEFINITIONS[profileId] ?? PROFILE_DEFINITIONS[DEFAULT_PROFILE];
  const resolved = {};
  for (const key of FEATURE_KEYS) {
    resolved[key] = Math.max(0, toNumber(profile.weights[key], 0));
  }
  return resolved;
}

function toNumber(value, fallback = 0) {
  return isFiniteNumber(value) ? value : fallback;
}

/** Re-exported so UI code can show the same version as the posted results. */
export { ENGINE_VERSION, CONFIG_VERSION };

/** Convenience for callers that already have a score result. */
export function isUsable(result) {
  return Boolean(result) && result.status === 'ok' && result.total != null;
}

/** Clamp helper kept here for API-side weight validation. */
export function normalizeWeightVector(weights) {
  const resolved = {};
  for (const key of FEATURE_KEYS) {
    resolved[key] = clamp(toNumber(weights?.[key], 0), 0, 100);
  }
  return resolved;
}
