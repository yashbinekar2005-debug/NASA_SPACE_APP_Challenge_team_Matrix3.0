import test from 'node:test';
import assert from 'node:assert/strict';

import {
  capabilityDistance,
  categoricalDistance,
  continuousDistance,
  distributionDistance,
  evidenceClassDistance,
  indexDistance
} from '../js/core/algorithm/distance.js';
import {
  clamp01,
  celsiusToKelvin,
  kelvinToCelsius,
  percentileRank,
  quantile,
  robustZ,
  stableStringify
} from '../js/core/algorithm/normalize.js';
import {
  ENGINE_VERSION,
  CONFIG_VERSION,
  PROFILE_ORDER
} from '../js/core/algorithm/features.js';
import {
  ablate,
  normalizeWeightVector,
  rankAnalogs,
  runSimilarity,
  score,
  tier
} from '../js/core/algorithm/engine.js';
import { ANALOGS, PRESETS, TARGETS } from '../js/data/index.js';

/* ----------------------------- fixtures ----------------------------- */

const weights = (overrides = {}) => ({
  temp: 50,
  ice: 50,
  soil: 50,
  terrain: 50,
  dry: 50,
  tube: 50,
  ...overrides
});

function site(id, values, conf = 'High') {
  return {
    id,
    name: id,
    region: 'test region',
    body: 'mars',
    conf,
    v: {
      temp: 0,
      ice: 50,
      soil: 50,
      terrain: 50,
      dry: 50,
      tube: 0,
      ...values
    }
  };
}

const close = (actual, expected, tolerance = 1e-6) => {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `expected ${actual} to be within ${tolerance} of ${expected}`
  );
};

/* --------------------------- math primitives ------------------------ */

test('continuous distance uses the documented cap and is bounded to [0,1]', () => {
  close(continuousDistance(0, 100, 200), 0.5);
  close(continuousDistance(-190, 15, 200), 1); // unbounded gap is capped
  close(continuousDistance(10, 10, 200), 0);
  assert.equal(continuousDistance(null, 10, 200), null);
  assert.equal(continuousDistance(10, 10, 0), null);
});

test('index and capability distances behave as documented', () => {
  close(indexDistance(20, 80), 0.6);
  close(capabilityDistance(92), 0.08);
  close(capabilityDistance(0), 1);
  assert.equal(capabilityDistance(null), null);
});

test('evidence-class distance compares ordered evidence, not values', () => {
  close(evidenceClassDistance(1, 3, 3), 2 / 3);
  close(evidenceClassDistance(2, 2, 3), 0);
  assert.equal(evidenceClassDistance(null, 2, 3), null);
});

test('categorical distance uses a documented matrix when supplied', () => {
  assert.equal(categoricalDistance('a', 'a'), 0);
  assert.equal(categoricalDistance('a', 'b'), 1);
  close(categoricalDistance('a', 'b', { a: { b: 0.25 } }), 0.25);
  assert.equal(categoricalDistance(null, 'b'), null);
});

test('distribution distance is a normalized Wasserstein distance', () => {
  const a = { p10: -30, p50: -20, p90: -10 };
  const b = { p10: -20, p50: -10, p90: 0 };
  close(distributionDistance(a, b, 200), 10 / 200);
  close(distributionDistance(a, a, 200), 0);
  // Mismatched probability levels must not be compared.
  assert.equal(
    distributionDistance({ p10: -30, p90: -10 }, { p25: -20, p75: 0 }, 200),
    null
  );
});

test('normalization utilities are stable', () => {
  close(clamp01(-1), 0);
  close(clamp01(2), 1);
  close(celsiusToKelvin(0), 273.15);
  close(kelvinToCelsius(273.15), 0);
  close(quantile([0, 10, 20, 30], 0.5), 15);
  close(percentileRank(20, [0, 10, 20, 30]), 2 / 3);
  close(robustZ(15, 10, 5), 1);
  assert.equal(robustZ(15, 10, 0), null);
  assert.equal(stableStringify({ b: 1, a: 2 }), '{"a":2,"b":1}');
});

/* ----------------------------- scoring ------------------------------ */

test('identical sites score 100 and all applicable features are perfect matches', () => {
  const target = site('target', {});
  const analog = site('analog', {});
  const result = score(target, analog, weights());

  close(result.total, 100);
  close(result.coverage, 1);
  assert.equal(result.status, 'ok');
  assert.equal(result.matchedFeatures.length, 5); // tube is not applicable at 0
  assert.equal(result.parts.find((p) => p.f.k === 'tube').applicable, false);
  assert.equal(result.parts.find((p) => p.f.k === 'tube').reason, 'not_applicable');
  close(result.confidence, 100 * result.parts
    .filter((p) => p.valid && p.wt > 0)
    .reduce((sum, p) => sum + p.wt * p.comparability, 0) /
    result.parts.filter((p) => p.valid && p.wt > 0).reduce((sum, p) => sum + p.wt, 0), 1e-9);
});

test('weighted distance is renormalised over valid comparable features', () => {
  const target = site('target', { temp: -60 });
  const analog = site('analog', { temp: -20 }); // 40 °C gap / 200 = 0.2
  const result = score(target, analog, weights());

  // Five applicable features; only temperature has a non-zero distance.
  close(result.total, 100 * (1 - 0.2 / 5));
  close(result.coverage, 1);
  close(result.normalizedDistance, 0.2 / 5);
});

test('missing data is excluded, not replaced with zero, and lowers coverage', () => {
  const target = site('target', { temp: -60 });
  const analog = site('analog', { temp: -20, terrain: null });
  const result = score(target, analog, weights());

  const terrain = result.parts.find((p) => p.f.k === 'terrain');
  assert.equal(terrain.na, true);
  assert.equal(terrain.valid, false);
  assert.equal(terrain.reason, 'missing_data');
  assert.equal(terrain.wt, 0);
  close(result.coverage, 4 / 5);
  close(result.total, 100 * (1 - 0.2 / 4)); // renormalised over four features
  assert.ok(result.warnings.some((warning) => warning.includes('Missing')));
});

test('zero weights produce no score rather than a misleading 0% match', () => {
  const target = site('target', {});
  const analog = site('analog', {});
  const result = score(target, analog, weights({
    temp: 0, ice: 0, soil: 0, terrain: 0, dry: 0, tube: 0
  }));

  assert.equal(result.total, 0);
  assert.equal(result.status, 'no_weights');
  assert.equal(result.insufficientData, true);
});

test('low coverage is flagged as provisional', () => {
  const target = site('target', { temp: -60 });
  const analog = site('analog', {
    temp: -20,
    ice: null,
    soil: null,
    terrain: null,
    dry: null
  });
  const result = score(target, analog, weights());

  close(result.coverage, 1 / 5);
  assert.equal(result.status, 'insufficient_coverage');
  assert.ok(result.warnings.some((warning) => warning.includes('below the')));
});

test('tube capability only applies when the target has a mapped tube', () => {
  const noTube = score(site('target', { tube: 0 }), site('analog', { tube: 90 }), weights());
  assert.equal(noTube.parts.find((p) => p.f.k === 'tube').applicable, false);

  const withTube = score(site('target', { tube: 90 }), site('analog', { tube: 92 }), weights());
  const tube = withTube.parts.find((p) => p.f.k === 'tube');
  assert.equal(tube.applicable, true);
  assert.equal(tube.valid, true);
  close(tube.sim, 92);
  close(tube.d, 0.08);
});

test('missing target tube is reported as missing, not as "no tube"', () => {
  const target = site('target', { tube: null });
  const analog = site('analog', { tube: 90 });
  const result = score(target, analog, weights());
  const tube = result.parts.find((p) => p.f.k === 'tube');
  assert.equal(tube.applicable, false);
  assert.equal(tube.reason, 'missing_target');
});

test('ordered evidence classes override raw index values when both exist', () => {
  const target = site('target', { ice: { value: 70, evidenceClass: 1 } });
  const analog = site('analog', { ice: { value: 85, evidenceClass: 3 } });
  const result = score(target, analog, weights());
  const ice = result.parts.find((p) => p.f.k === 'ice');

  assert.equal(ice.valid, true);
  close(ice.d, 2 / 3, 1e-4);
  close(ice.sim, 100 * (1 - 2 / 3), 0.1);
});

test('index fallback is used when only one side has an evidence class', () => {
  const target = site('target', { ice: { value: 70, evidenceClass: 1 } });
  const analog = site('analog', { ice: { value: 85 } });
  const result = score(target, analog, weights());
  const ice = result.parts.find((p) => p.f.k === 'ice');

  close(ice.d, 0.15);
  close(ice.sim, 85);
});

test('temperature distributions use quantile distance when both sides provide them', () => {
  const target = site('target', {
    temp: { quantiles: { p10: -200, p50: -190, p90: -180 } }
  });
  const analog = site('analog', {
    temp: { quantiles: { p10: -30, p50: -20, p90: -10 } }
  });
  const result = score(target, analog, weights());
  const temp = result.parts.find((p) => p.f.k === 'temp');

  assert.equal(temp.distributionUsed, true);
  close(temp.d, 0.85);
  close(temp.sim, 15);
});

test('confidence is separate from similarity and reflects documentation quality', () => {
  const target = site('high-target', {}, 'High');
  const high = site('high-site', {}, 'High');
  const low = site('low-site', {}, 'Low');

  const highResult = score(target, high, weights());
  const lowResult = score(target, low, weights());

  close(highResult.total, lowResult.total); // same measurements
  assert.ok(highResult.confidence > lowResult.confidence);
  assert.equal(highResult.confidenceLabel, 'High');
  assert.equal(lowResult.confidenceLabel, 'Medium');
});

test('uniform weight scaling does not change the score', () => {
  const target = site('target', { temp: -60 });
  const analog = site('analog', { temp: -20 });
  const a = score(target, analog, weights());
  const b = score(target, analog, weights({
    temp: 5, ice: 5, soil: 5, terrain: 5, dry: 5, tube: 5
  }));

  close(a.total, b.total);
  assert.notEqual(a.fingerprint, b.fingerprint); // different weight vector
});

test('a site with no comparable measurements is rejected rather than scored as zero', () => {
  const target = site('target', {
    temp: null, ice: null, soil: null, terrain: null, dry: null, tube: null
  });
  const analog = site('analog', {
    temp: null, ice: null, soil: null, terrain: null, dry: null, tube: null
  });
  const result = score(target, analog, weights());

  assert.equal(result.total, 0);
  assert.equal(result.coverage, 0);
  assert.equal(result.status, 'no_comparable_features');
  assert.ok(result.explanation.includes('no comparable measurements'));
});

test('measurement metadata is preserved for provenance', () => {
  const target = site('target', {
    temp: { value: -60, uncertainty: 2, source: 'MOLA-derived' }
  });
  const analog = site('analog', { temp: -20 });
  const result = score(target, analog, weights());
  const temp = result.parts.find((p) => p.f.k === 'temp');

  assert.equal(temp.targetRaw.source, 'MOLA-derived');
  assert.equal(temp.targetRaw.uncertainty, 2);
});

test('fixed profiles are independent views and use their own weights', () => {
  const target = TARGETS.find((t) => t.id === 'jezero');
  const analog = ANALOGS.find((a) => a.id === 'atacama');
  const result = score(target, analog, PRESETS[0].w);
  const temp = result.parts.find((p) => p.f.k === 'temp');
  const ice = result.parts.find((p) => p.f.k === 'ice');
  const dry = result.parts.find((p) => p.f.k === 'dry');

  assert.deepEqual(Object.keys(result.profiles), [...PROFILE_ORDER]);
  close(result.profiles.thermal.score, temp.sim, 0.1);

  const expectedWater = 100 * (1 - ((ice.d * 1 + dry.d * 0.75) / 1.75));
  close(result.profiles.water_volatile.score, expectedWater, 0.1);
  assert.equal(result.profiles.water_volatile.status, 'ok');
});

test('a named profile can supply the weights when none are passed', () => {
  const target = site('target', { temp: -60 });
  const analog = site('analog', { temp: -20 });
  const result = score(target, analog, null, { profile: 'thermal' });
  const temp = result.parts.find((p) => p.f.k === 'temp');

  assert.equal(result.profile, 'thermal');
  close(result.weights.temp, 1);
  close(result.weights.ice, 0);
  close(result.total, temp.sim);
  assert.equal(result.matchedFeatures.length, 1);
});

test('ranking is deterministic and tie-breaks by candidate id', () => {
  const target = site('target', {});
  const a = site('a', {});
  const b = site('b', {});
  const ranked = rankAnalogs(target, [b, a], weights());

  assert.equal(ranked[0].analog.id, 'a');
  assert.equal(ranked[1].analog.id, 'b');
  assert.equal(ranked[0].total, ranked[1].total);
});

test('the prototype ranking is sorted and reproducible', () => {
  const target = TARGETS[0];
  const ranked = rankAnalogs(target, ANALOGS, PRESETS[0].w);
  const again = rankAnalogs(target, ANALOGS, PRESETS[0].w);

  assert.equal(ranked.length, ANALOGS.length);
  assert.equal(ranked[0].analog.id, 'devon');
  for (let i = 1; i < ranked.length; i += 1) {
    assert.ok(ranked[i - 1].total >= ranked[i].total);
  }
  assert.deepEqual(
    ranked.map((r) => [r.analog.id, r.total, r.fingerprint]),
    again.map((r) => [r.analog.id, r.total, r.fingerprint])
  );
});

test('reproducible fingerprint changes with the profile or weight vector', () => {
  const target = TARGETS[0];
  const analog = ANALOGS[0];
  const base = score(target, analog, PRESETS[0].w);
  const heavier = score(target, analog, { ...PRESETS[0].w, temp: 90 });
  const thermal = score(target, analog, PRESETS[0].w, { profile: 'thermal' });

  assert.notEqual(base.fingerprint, heavier.fingerprint);
  assert.notEqual(base.fingerprint, thermal.fingerprint);
  assert.equal(base.engineVersion, ENGINE_VERSION);
  assert.equal(base.configVersion, CONFIG_VERSION);
});

test('weight validation clamps to the documented 0–100 range', () => {
  const normalized = normalizeWeightVector({
    temp: 150, ice: -5, soil: 'x', terrain: 40
  });
  assert.equal(normalized.temp, 100);
  assert.equal(normalized.ice, 0);
  assert.equal(normalized.soil, 0);
  assert.equal(normalized.terrain, 40);
});

test('tier labels remain compatible with the original UI', () => {
  assert.equal(tier(90), 'Strong match');
  assert.equal(tier(70), 'Good match');
  assert.equal(tier(55), 'Partial match');
  assert.equal(tier(20), 'Weak match');
});

test('runSimilarity returns the plan-shaped API payload', () => {
  const payload = runSimilarity({
    target: TARGETS.find((t) => t.id === 'jezero'),
    candidates: ANALOGS,
    weights: PRESETS[0].w,
    topK: 3,
    profile: 'custom'
  });

  assert.equal(payload.target_body, 'mars');
  assert.equal(payload.target_region_id, 'jezero');
  assert.equal(payload.profile, 'custom');
  assert.equal(payload.results.length, 3);
  assert.equal(payload.results[0].rank, 1);
  assert.equal(payload.results[0].feature_contributions.length, 6);
  assert.ok(Array.isArray(payload.results[0].matched_features));
  assert.ok(Array.isArray(payload.warnings));
  assert.equal(payload.engine_version, ENGINE_VERSION);
  assert.equal(payload.config_version, CONFIG_VERSION);
});

test('ablation reports the effect of removing each feature', () => {
  const result = ablate(TARGETS[0], ANALOGS, PRESETS[0].w);
  assert.equal(result.baseline.length, 5);
  assert.deepEqual(Object.keys(result.features).sort(), [
    'dry', 'ice', 'soil', 'temp', 'terrain', 'tube'
  ]);
  for (const entry of Object.values(result.features)) {
    assert.ok(entry.mean_abs_score_delta >= 0);
    assert.equal(entry.top.length, 5);
  }
});
