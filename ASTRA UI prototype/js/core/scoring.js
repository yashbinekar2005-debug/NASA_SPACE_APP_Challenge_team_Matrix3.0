import {
  ENGINE_VERSION,
  CONFIG_VERSION,
  PROFILE_DEFINITIONS,
  PROFILE_ORDER
} from './algorithm/features.js';
import {
  ablate,
  normalizeWeightVector,
  rankAnalogs as rankEngine,
  runSimilarity,
  score as scoreEngine,
  tier as tierEngine
} from './algorithm/engine.js';

/**
 * Public scoring facade.
 *
 * The UI has always imported `score()`, `tier()` and `rankAnalogs()` from
 * this module. Those signatures are preserved so the ASTRA prototype keeps
 * working, while the implementation now lives in `core/algorithm/`.
 *
 * Results keep the original shape — `{ total, parts }` with
 * `parts[i] = { f, t, a, sim, wt, na }` — and add coverage, confidence,
 * profiles, drivers, warnings and a reproducible fingerprint.
 */

export function score(target, analog, weights, options) {
  return scoreEngine(target, analog, weights, options);
}

export function rankAnalogs(target, analogs, weights, options) {
  return rankEngine(target, analogs, weights, options);
}

/** Human label for a 0–100 match score. */
export const tier = tierEngine;

export {
  ENGINE_VERSION,
  CONFIG_VERSION,
  PROFILE_DEFINITIONS,
  PROFILE_ORDER,
  ablate,
  normalizeWeightVector,
  runSimilarity
};
