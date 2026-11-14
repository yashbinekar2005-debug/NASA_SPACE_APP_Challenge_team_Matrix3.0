import { FACTORS } from '../../data/factors.js';

/**
 * Algorithm feature model and fixed score profiles.
 *
 * The UI sliders define a custom weight vector. Profiles are additional,
 * independent fixed-weight views of the same per-feature distances. They
 * are not extra measurements and they do not change the custom ranking.
 */

export const ENGINE_VERSION = '2.0.0';
export const CONFIG_VERSION = '2026.11.2';

export const FEATURE_KEYS = FACTORS.map((f) => f.k);
export const FEATURE_BY_KEY = Object.freeze(
  Object.fromEntries(FACTORS.map((f) => [f.k, f]))
);

/** How much trust to place in a site's public documentation. */
export const CONFIDENCE_SCORE = Object.freeze({
  High: 1,
  Medium: 0.72,
  Low: 0.45,
  Unknown: 0.25
});

export const DEFAULTS = Object.freeze({
  /** Minimum share of requested weight that must have valid comparisons. */
  minCoverage: 0.5,
  /** Minimum number of valid features before a score is considered usable. */
  minFeatures: 2,
  /** Tube index at or above which a target is treated as having a tube. */
  tubeThreshold: 50
});

/**
 * Fixed-weight profiles. Each weight is a relative importance, not a
 * percentage; only the ratio matters. The caveats are surfaced in the UI
 * and in API warnings.
 */
export const PROFILE_DEFINITIONS = {
  balanced_overall: {
    id: 'balanced_overall',
    label: 'Balanced overall',
    description: 'All comparable features equally weighted.',
    weights: { temp: 1, solar: 1, ice: 1, soil: 1, terrain: 1, dry: 1, tube: 1 },
    caveat:
      'The overall score is a research prototype. It is relative to the selected features ' +
      'and weights and has not been validated as a measure of habitability or mission suitability.'
  },
  thermal: {
    id: 'thermal',
    label: 'Thermal',
    description: 'Surface temperature and illumination similarity.',
    weights: { temp: 1, solar: 1 },
    caveat: 'Compares regional temperature statistics, not local-time or seasonal extremes.'
  },
  terrain: {
    id: 'terrain',
    label: 'Terrain',
    description: 'Roughness and ground character.',
    weights: { terrain: 1, soil: 0.5 },
    caveat: 'Uses regional roughness/composition proxies; it is not a traversability analysis.'
  },
  geological: {
    id: 'geological',
    label: 'Geological',
    description: 'Composition, terrain and volcanic/tube morphology.',
    weights: { soil: 1, terrain: 0.75, tube: 0.5 },
    caveat: 'Mineralogy and morphology are proxies; no spectral unmixing is performed here.'
  },
  water_volatile: {
    id: 'water_volatile',
    label: 'Water / volatile',
    description: 'Ice/water evidence and aridity proxies.',
    weights: { ice: 1, dry: 0.75 },
    caveat:
      'Ice/water and dryness are evidence proxies. A high score does not establish accessible ' +
      'liquid water or a usable volatile resource.'
  },
  mission_operations: {
    id: 'mission_operations',
    label: 'Mission operations',
    description: 'Terrain, thermal conditions and tube shelter capability.',
    weights: { temp: 0.5, solar: 0.5, terrain: 1, tube: 1 },
    caveat:
      'A first-order operations view only. Illumination, communication, dust, radiation and ' +
      'trafficability are not modelled.'
  }
};

export const PROFILE_ORDER = Object.freeze([
  'balanced_overall',
  'thermal',
  'terrain',
  'geological',
  'water_volatile',
  'mission_operations'
]);

export const DEFAULT_PROFILE = 'balanced_overall';

/** Convert a stored factor value object into the numeric value the UI shows. */
export function displayValue(raw) {
  if (typeof raw === 'number') return raw;
  if (raw && typeof raw === 'object') {
    if (Number.isFinite(raw.value)) return raw.value;
    if (Number.isFinite(raw.median)) return raw.median;
    if (Number.isFinite(raw.mean)) return raw.mean;
  }
  return null;
}
