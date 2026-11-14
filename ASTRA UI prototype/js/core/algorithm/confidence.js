import { CONFIDENCE_SCORE } from './features.js';
import { clamp, isFiniteNumber, round } from './normalize.js';

/**
 * Confidence is deliberately separate from similarity.
 *
 * Similarity answers "how close are the measurements?".
 * Confidence answers "how much of the requested comparison was actually
 * available, how well documented are the sites, and how comparable are the
 * measurements across bodies?".
 *
 * coverage      = valid requested weight / requested weight
 * quality       = mean documentation quality of target and candidate
 * comparability = weight-averaged feature comparability
 * confidence    = 100 × coverage × quality × comparability
 *
 * The product is intentionally conservative. A high score from one weak,
 * indirect feature can never look as trustworthy as a high score from many
 * well-documented direct features.
 */

export function coverageOf(parts) {
  let requested = 0;
  let valid = 0;

  for (const part of parts) {
    if (!part.applicable || !(part.wtRequested > 0)) continue;
    requested += part.wtRequested;
    if (part.valid) valid += part.wtRequested;
  }

  return requested > 0 ? clamp(valid / requested, 0, 1) : 0;
}

/**
 * Weight-averaged comparability of the features that actually contributed.
 * `weightOf` lets profile scores use their own weight vector.
 */
export function comparabilityOf(parts, weightOf = (part) => part.wt) {
  let weighted = 0;
  let total = 0;

  for (const part of parts) {
    if (!part.valid) continue;
    const weight = weightOf(part);
    if (!(weight > 0)) continue;
    weighted += weight * (isFiniteNumber(part.comparability) ? part.comparability : 0);
    total += weight;
  }

  return total > 0 ? clamp(weighted / total, 0, 1) : 0;
}

export function documentationQuality(target, analog) {
  const targetScore = CONFIDENCE_SCORE[target?.conf] ?? CONFIDENCE_SCORE.Unknown;
  const analogScore = CONFIDENCE_SCORE[analog?.conf] ?? CONFIDENCE_SCORE.Unknown;
  return (targetScore + analogScore) / 2;
}

export function confidenceOf({ coverage, target, analog, parts, weightOf }) {
  const quality = documentationQuality(target, analog);
  const comparability = comparabilityOf(parts, weightOf);
  return round(100 * clamp(coverage, 0, 1) * quality * comparability, 1);
}

export function confidenceLabel(confidence) {
  if (!isFiniteNumber(confidence)) return 'Unknown';
  if (confidence >= 67) return 'High';
  if (confidence >= 42) return 'Medium';
  return 'Low';
}

/** Share of valid requested weight, rounded for display. */
export function coveragePercent(parts) {
  return Math.round(coverageOf(parts) * 100);
}
