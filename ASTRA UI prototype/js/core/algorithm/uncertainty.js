import { clamp, isFiniteNumber, round } from './normalize.js';

/**
 * Score uncertainty — deliberately separate from confidence and similarity.
 *
 * Similarity: how close are the measurements?
 * Confidence: how complete and comparable is the evidence?
 * Uncertainty: how large is the propagated measurement error on the score?
 *
 * First-order propagation:
 *   σ_d,i = sqrt(σ_target,i² + σ_candidate,i²) / scale_i
 *   σ_D   = sqrt( Σ (w_i / Σw)² · σ_d,i² )
 *   σ_S   = 100 · sqrt( σ_D² + σ_model² )
 *
 * `σ_model` is a small floor for cross-body comparability. It is not a random
 * error and it is not used to make a weak match look uncertain; it documents
 * the fact that different instruments and spatial scales cannot be compared
 * perfectly.
 */

const DEFAULT_CLASS_SIGMA = 0.4;
const DEFAULT_CONTINUOUS_SIGMA = 1;
const DEFAULT_INDEX_SIGMA = 5;
const DEFAULT_CAPABILITY_SIGMA = 8;

export function propagateUncertainty(parts, { modelFloor = null } = {}) {
  const active = parts.filter((part) => part.valid && part.wt > 0);
  const weightTotal = active.reduce((sum, part) => sum + part.wt, 0);

  if (!active.length || !(weightTotal > 0)) {
    return {
      sigma: null,
      interval95: null,
      certainty: null,
      certaintyLabel: 'Unknown',
      perFeature: {},
      method: 'No valid weighted features, so no score uncertainty can be propagated.'
    };
  }

  const perFeature = {};
  let variance = 0;
  let comparabilityWeighted = 0;

  for (const part of active) {
    const sigma = featureSigma(part);
    const share = part.wt / weightTotal;
    variance += (share * sigma) ** 2;
    comparabilityWeighted += share * (isFiniteNumber(part.comparability) ? part.comparability : 0);
    perFeature[part.f.k] = {
      label: part.f.label,
      sigma_distance: round(sigma, 4),
      sigma_points: round(100 * sigma, 1),
      weight_share: round(share, 4),
      target_uncertainty: round(finiteOr(part.targetUncertainty, defaultTargetSigma(part)), 2),
      candidate_uncertainty: round(finiteOr(part.candidateUncertainty, defaultCandidateSigma(part)), 2),
      evidence_based: Boolean(part.evidenceBasis)
    };
  }

  const comparability = clamp(comparabilityWeighted, 0, 1);
  const floor = isFiniteNumber(modelFloor)
    ? modelFloor
    : 0.015 + 0.05 * (1 - comparability);

  const sigmaDistance = Math.sqrt(variance + floor ** 2);
  const sigma = 100 * sigmaDistance;
  const total = 100 * (1 - active.reduce((sum, part) => sum + part.d * part.wt, 0) / weightTotal);
  const low = clamp(total - 1.96 * sigma, 0, 100);
  const high = clamp(total + 1.96 * sigma, 0, 100);

  return {
    sigma: round(sigma, 1),
    interval95: [round(low, 1), round(high, 1)],
    certainty: round(clamp(100 - 2 * sigma, 0, 100), 0),
    certaintyLabel: certaintyLabel(100 - 2 * sigma),
    perFeature,
    modelFloor: round(100 * floor, 1),
    comparability: round(comparability, 3),
    method:
      'First-order propagation of target and candidate measurement uncertainty, ' +
      'weighted by each feature’s share of the score, plus a documented cross-body model floor.'
  };
}

function featureSigma(part) {
  const feature = part.f;
  const targetSigma = finiteOr(part.targetUncertainty, defaultTargetSigma(part));
  const candidateSigma = finiteOr(part.candidateUncertainty, defaultCandidateSigma(part));

  if (feature.kind === 'capability') {
    return candidateSigma / (feature.scale ?? 100);
  }

  if (part.evidenceBasis) {
    const targetClassSigma = finiteOr(part.targetEvidenceClassUncertainty, DEFAULT_CLASS_SIGMA);
    const candidateClassSigma = finiteOr(part.candidateEvidenceClassUncertainty, DEFAULT_CLASS_SIGMA);
    return Math.hypot(targetClassSigma, candidateClassSigma) / 3;
  }

  const scale = feature.kind === 'continuous'
    ? (feature.distanceCap ?? 100)
    : (feature.scale ?? 100);

  return Math.hypot(targetSigma, candidateSigma) / scale;
}

function defaultTargetSigma(part) {
  if (part.f.kind === 'continuous') return part.f.k === 'solar' ? 0.3 : DEFAULT_CONTINUOUS_SIGMA;
  if (part.f.kind === 'capability') return 0;
  return DEFAULT_INDEX_SIGMA;
}

function defaultCandidateSigma(part) {
  if (part.f.kind === 'continuous') return part.f.k === 'solar' ? 0.3 : DEFAULT_CONTINUOUS_SIGMA;
  if (part.f.kind === 'capability') return DEFAULT_CAPABILITY_SIGMA;
  return DEFAULT_INDEX_SIGMA;
}

function finiteOr(value, fallback) {
  return isFiniteNumber(value) ? value : fallback;
}

export function certaintyLabel(certainty) {
  if (!isFiniteNumber(certainty)) return 'Unknown';
  if (certainty >= 80) return 'High';
  if (certainty >= 55) return 'Medium';
  return 'Low';
}
