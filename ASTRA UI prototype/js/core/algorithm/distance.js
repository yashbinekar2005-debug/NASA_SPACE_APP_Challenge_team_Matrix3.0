import { clamp01, isFiniteNumber, quantileSeries, safeDiv } from './normalize.js';

/**
 * Bounded per-feature distances.
 *
 * Contract: every function returns a number in [0, 1], or null when the
 * inputs are not comparable. A distance of 0 is a perfect match; 1 is the
 * documented cap. The engine turns the weighted mean distance into
 * `Similarity = 100 × (1 − D)`.
 */

/**
 * Continuous distance with an explicit physical cap.
 * Example: |15 °C − (−190 °C)| / 200 °C = 1.025 → bounded to 1.
 */
export function continuousDistance(target, candidate, cap) {
  if (!isFiniteNumber(target) || !isFiniteNumber(candidate) ||
      !isFiniteNumber(cap) || cap <= 0) {
    return null;
  }
  return clamp01(Math.abs(target - candidate) / cap);
}

/** Distance between two 0–100 (or 0–`scale`) indexes. */
export function indexDistance(target, candidate, scale = 100) {
  return continuousDistance(target, candidate, scale);
}

/**
 * Capability distance. A capability is not a difference between two
 * planets; it is how much of the requested capability the candidate offers.
 * A candidate at `scale` scores 0 distance; a candidate at 0 scores 1.
 */
export function capabilityDistance(candidate, scale = 100) {
  if (!isFiniteNumber(candidate) || !isFiniteNumber(scale) || scale <= 0) {
    return null;
  }
  return clamp01(1 - candidate / scale);
}

/**
 * 1-D Wasserstein distance between equal-probability quantile sets,
 * normalized by the feature cap. This is the distribution comparison
 * described in the project plan and is only valid when both sides expose
 * the same probability levels.
 */
export function distributionDistance(targetDistribution, candidateDistribution, cap) {
  const target = quantileSeries(targetDistribution);
  const candidate = quantileSeries(candidateDistribution);
  if (!target || !candidate) return null;
  if (target.probs.length !== candidate.probs.length) return null;
  if (target.probs.some((prob, index) => prob !== candidate.probs[index])) return null;

  let total = 0;
  for (let i = 0; i < target.values.length; i += 1) {
    total += Math.abs(target.values[i] - candidate.values[i]);
  }
  return continuousDistance(0, safeDiv(total, target.values.length), cap);
}

/**
 * Distance between ordered evidence classes (0 none … 3 strong).
 * Class 0 is "no evidence detected", not proof of absence; callers must
 * preserve that caveat in the explanation.
 */
export function evidenceClassDistance(targetClass, candidateClass, classes = 3) {
  if (!isFiniteNumber(targetClass) || !isFiniteNumber(candidateClass) || classes <= 0) {
    return null;
  }
  return clamp01(Math.abs(targetClass - candidateClass) / classes);
}

/**
 * Categorical mismatch cost. `matrix[a][b]` can document partial similarity;
 * without a matrix, unequal classes are a full mismatch.
 */
export function categoricalDistance(targetClass, candidateClass, matrix = null) {
  if (targetClass == null || candidateClass == null) return null;
  if (targetClass === candidateClass) return 0;
  if (matrix && matrix[targetClass] && isFiniteNumber(matrix[targetClass][candidateClass])) {
    return clamp01(matrix[targetClass][candidateClass]);
  }
  return 1;
}

/**
 * Dispatch for one already-read feature measurement. `quantiles` are used
 * only when both sides provide them; otherwise the scalar value is used.
 */
export function featureDistance(feature, target, candidate) {
  if (!feature) return null;

  if (feature.kind === 'capability') {
    return capabilityDistance(candidate.value, feature.scale ?? 100);
  }

  const cap = feature.kind === 'continuous'
    ? feature.distanceCap
    : (feature.scale ?? 100);

  if (target.quantiles && candidate.quantiles) {
    return distributionDistance(target.quantiles, candidate.quantiles, cap);
  }

  if (feature.kind === 'continuous') {
    return continuousDistance(target.value, candidate.value, cap);
  }

  return indexDistance(target.value, candidate.value, cap);
}
