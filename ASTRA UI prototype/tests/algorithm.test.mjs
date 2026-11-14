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
import { ANALOGS, DISCOVERY, FACTORS, PRESETS, TARGETS, nonReplicableFor } from '../js/data/index.js';
import { fmt, fmtCoords, fmtUncertainty } from '../js/utils/format.js';
import { state, curTarget } from '../js/core/state.js';
import { project, unproject } from '../js/graphics/globe.js';
import { rankMeasuredMarsPoint, validateMarsPointResponse, rankMeasuredEarthPoint, validateEarthPointResponse, rankMeasuredPoint, validatePointProbe } from '../js/core/research.js';
import {
  marsDryness,
  marsGeologyProxy,
  marsIceEvidence,
  mcdColumn,
  moonFeoProxy,
  moonSolarEstimate,
  polarXY,
  reliefIndex
} from '../tools/lib/planetary-probe.mjs';
import { parseMcdSeries, summarizeMcdSeries } from '../tools/lib/sources/mcd.mjs';

/* ----------------------------- fixtures ----------------------------- */

const weights = (overrides = {}) => ({
  temp: 50,
  solar: 50,
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
      solar: 6,
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
  assert.equal(result.matchedFeatures.length, 6); // tube is not applicable at 0
  assert.equal(result.parts.find((p) => p.f.k === 'tube').applicable, false);
  assert.equal(result.parts.find((p) => p.f.k === 'tube').reason, 'not_applicable');
  close(result.confidence, 100 * result.parts
    .filter((p) => p.valid && p.wt > 0)
    .reduce((sum, p) => sum + p.wt * p.comparability, 0) /
    result.parts.filter((p) => p.valid && p.wt > 0).reduce((sum, p) => sum + p.wt, 0), 0.1);
});

test('weighted distance is renormalised over valid comparable features', () => {
  const target = site('target', { temp: -60 });
  const analog = site('analog', { temp: -20 }); // 40 °C gap / 200 = 0.2
  const result = score(target, analog, weights());

  // Six applicable features; only temperature has a non-zero distance.
  close(result.total, 100 * (1 - 0.2 / 6));
  close(result.coverage, 1);
  close(result.normalizedDistance, 0.2 / 6);
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
  close(result.coverage, 5 / 6, 1e-4);
  close(result.total, 100 * (1 - 0.2 / 5)); // renormalised over five features
  assert.ok(result.warnings.some((warning) => warning.includes('Missing')));
});

test('zero weights produce no score rather than a misleading 0% match', () => {
  const target = site('target', {});
  const analog = site('analog', {});
  const result = score(target, analog, weights({
    temp: 0, solar: 0, ice: 0, soil: 0, terrain: 0, dry: 0, tube: 0
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

  // Temperature and solar remain; tube is not applicable to this target.
  close(result.coverage, 2 / 6, 1e-4);
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
  const medium = site('medium-site', {}, 'Medium');
  const unknown = site('unknown-site', {}, 'Unknown');

  const highResult = score(target, high, weights());
  const mediumResult = score(target, medium, weights());
  const unknownResult = score(target, unknown, weights());

  close(highResult.total, mediumResult.total); // same measurements
  close(highResult.total, unknownResult.total);
  assert.ok(highResult.confidence > mediumResult.confidence);
  assert.ok(mediumResult.confidence > unknownResult.confidence);
  // Full coverage with cross-body comparability limits tops out at "Medium";
  // a site with no documented provenance drops to "Low". Confidence is
  // deliberately conservative and is not the same scale as similarity.
  assert.equal(highResult.confidenceLabel, 'Medium');
  assert.equal(mediumResult.confidenceLabel, 'Medium');
  assert.equal(unknownResult.confidenceLabel, 'Low');
});

test('uniform weight scaling does not change the score', () => {
  const target = site('target', { temp: -60 });
  const analog = site('analog', { temp: -20 });
  const a = score(target, analog, weights());
  const b = score(target, analog, weights({
    temp: 5, solar: 5, ice: 5, soil: 5, terrain: 5, dry: 5, tube: 5
  }));

  close(a.total, b.total);
  assert.notEqual(a.fingerprint, b.fingerprint); // different weight vector
});

test('a site with no comparable measurements is rejected rather than scored as zero', () => {
  const target = site('target', {
    temp: null, solar: null, ice: null, soil: null, terrain: null, dry: null, tube: null
  });
  const analog = site('analog', {
    temp: null, solar: null, ice: null, soil: null, terrain: null, dry: null, tube: null
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
  const analog = ANALOGS[0];
  const result = score(target, analog, PRESETS[0].w);
  const temp = result.parts.find((p) => p.f.k === 'temp');
  const solar = result.parts.find((p) => p.f.k === 'solar');
  const ice = result.parts.find((p) => p.f.k === 'ice');
  const dry = result.parts.find((p) => p.f.k === 'dry');

  assert.deepEqual(Object.keys(result.profiles), [...PROFILE_ORDER]);
  close(
    result.profiles.thermal.score,
    (temp.sim + solar.sim) / 2,
    0.1
  );

  const expectedWater = 100 * (1 - ((ice.d * 1 + dry.d * 0.75) / 1.75));
  close(result.profiles.water_volatile.score, expectedWater, 0.1);
  assert.ok(['ok', 'insufficient_coverage'].includes(result.profiles.water_volatile.status));
});

test('a named profile can supply the weights when none are passed', () => {
  const target = site('target', { temp: -60 });
  const analog = site('analog', { temp: -20 });
  const result = score(target, analog, null, { profile: 'thermal' });
  const temp = result.parts.find((p) => p.f.k === 'temp');
  const solar = result.parts.find((p) => p.f.k === 'solar');

  assert.equal(result.profile, 'thermal');
  close(result.weights.temp, 1);
  close(result.weights.solar, 1);
  close(result.weights.ice, 0);
  close(result.total, (temp.sim + solar.sim) / 2);
  assert.equal(result.matchedFeatures.length, 2);
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

test('the discovered ranking is sorted and reproducible', () => {
  const target = TARGETS[0];
  const ranked = rankAnalogs(target, ANALOGS, PRESETS[0].w);
  const again = rankAnalogs(target, ANALOGS, PRESETS[0].w);

  assert.ok(ANALOGS.length >= 5);
  assert.equal(ranked.length, ANALOGS.length);
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
  assert.equal(payload.results[0].feature_contributions.length, 7);
  assert.ok(Array.isArray(payload.results[0].matched_features));
  assert.ok(Array.isArray(payload.warnings));
  assert.equal(payload.engine_version, ENGINE_VERSION);
  assert.equal(payload.config_version, CONFIG_VERSION);
});

test('ablation reports the effect of removing each feature', () => {
  const result = ablate(TARGETS[0], ANALOGS, PRESETS[0].w);
  assert.equal(result.baseline.length, 5);
  assert.deepEqual(Object.keys(result.features).sort(), [
    'dry', 'ice', 'soil', 'solar', 'temp', 'terrain', 'tube'
  ]);
  for (const entry of Object.values(result.features)) {
    assert.ok(entry.mean_abs_score_delta >= 0);
    assert.equal(entry.top.length, 5);
  }
});

/* --------------------------- uncertainty ---------------------------- */

test('solar is a measured factor with the documented 12 kWh/m²/day cap', () => {
  const solar = FACTORS.find((f) => f.k === 'solar');
  assert.ok(solar);
  assert.equal(solar.kind, 'continuous');
  assert.equal(solar.unit, 'kWh/m²/day');
  assert.equal(solar.distanceCap, 12);
  close(continuousDistance(0, 12, solar.distanceCap), 1);
});

test('score uncertainty grows with measurement error and is separate from confidence', () => {
  const target = site('target', {
    temp: { value: -60, uncertainty: 1 }
  });
  const small = site('small-error', {
    temp: { value: -20, uncertainty: 1 }
  });
  const large = site('large-error', {
    temp: { value: -20, uncertainty: 25 }
  });

  const a = score(target, small, weights());
  const b = score(target, large, weights());

  close(a.total, b.total); // same measured values
  assert.ok(b.uncertainty.sigma > a.uncertainty.sigma);
  assert.ok(b.confidence === a.confidence); // confidence is documentation quality
  assert.equal(typeof a.certainty, 'number');
  assert.ok(a.certainty > b.certainty);
  assert.equal(a.uncertainty.perFeature.temp.evidence_based, false);
  assert.ok(a.uncertainty.perFeature.temp.sigma_points > 0);
});

test('the 95 % score interval brackets the score for every discovered candidate', () => {
  for (const target of TARGETS) {
    for (const analog of ANALOGS.slice(0, 4)) {
      const result = score(target, analog, PRESETS[0].w);
      if (result.status === 'no_comparable_features') continue;
      const [low, high] = result.scoreInterval;
      assert.ok(low <= result.total + 1e-9, `${analog.id} low > total`);
      assert.ok(high >= result.total - 1e-9, `${analog.id} high < total`);
      assert.ok(low >= 0 && high <= 100);
      assert.ok(result.uncertainty.sigma >= 0);
    }
  }
});

/* ---------------------- non-replicable differences ------------------ */

test('Moon and Mars comparisons report the differences Earth cannot remove', () => {
  const moon = score(TARGETS.find((t) => t.id === 'shackleton'), ANALOGS[0], PRESETS[0].w);
  const mars = score(TARGETS.find((t) => t.id === 'jezero'), ANALOGS[0], PRESETS[0].w);

  assert.equal(moon.nonReplicable.length, 6);
  assert.equal(mars.nonReplicable.length, 6);
  const keys = moon.nonReplicable.map((d) => d.key);
  assert.deepEqual(keys, ['gravity', 'pressure', 'radiation', 'magnetic_field', 'day_length', 'atmosphere']);
  for (const entry of moon.nonReplicable) {
    assert.equal(entry.replicable, false);
    assert.ok(entry.why);
    assert.ok(entry.consequence);
    assert.ok(['fundamental', 'major'].includes(entry.severity));
    assert.ok(Array.isArray(entry.sources));
  }

  const gravity = moon.nonReplicable.find((d) => d.key === 'gravity');
  close(gravity.target, 1.62);
  close(gravity.ratio, 1.62 / 9.807, 1e-3);
  assert.equal(nonReplicableFor('earth').length, 0);
});

test('non-replicable differences never change the similarity score', () => {
  const target = TARGETS.find((t) => t.id === 'jezero');
  const analog = ANALOGS[0];
  const result = score(target, analog, PRESETS[0].w);
  const withoutTable = score({ ...target, body: 'mars' }, analog, PRESETS[0].w);
  close(result.total, withoutTable.total);
  assert.equal(withoutTable.nonReplicable.length, 6);
});

/* ----------------------- data provenance contract ------------------- */

test('the app starts without silently selecting a planetary location', () => {
  assert.equal(state.targetId, null);
  assert.equal(curTarget(), undefined);
  assert.equal(state.analogId, null);
  assert.deepEqual(state.ranked, []);
});

test('any visible globe coordinate can be converted to a pin and back', () => {
  const globe = { R: 100, S: 1, cx: 120, cy: 90, yaw: 0.42, tilt: -0.18, sway: 0.03 };
  for (const [lat, lon] of [[0, 0], [45, 70], [-36, 20]]) {
    const screen = project(globe, lat, lon);
    assert.ok(screen.z > 0, 'test location should be on the visible hemisphere');
    const roundTrip = unproject(globe, screen.x, screen.y);
    assert.ok(Math.abs(roundTrip.lat - lat) < 1e-8);
    const lonDifference = ((roundTrip.lon - lon + 540) % 360) - 180;
    assert.ok(Math.abs(lonDifference) < 1e-8);
  }
});

test('Mars coordinate results require complete current-execution MCD measurements', () => {
  const source = {
    id: 'mars-climate-database-6.2',
    name: 'LMD Mars Climate Database v6.2',
    url: 'https://www-mars.lmd.jussieu.fr/mars/access',
    reference: 'https://www-mars.lmd.jussieu.fr/mcd_python/txt/0123456789abcdef.txt',
    period: '12-season climatology; diurnal means; 25 seasonal samples',
    resolution: 'Interpolated model grid',
    evidenceType: 'modelled_climatology'
  };
  const payload = {
    dataset: 'Mars Climate Database v6.2',
    source,
    values: {
      temp: { value: -63, unit: '°C', seasonalSpread: 20, source },
      solar: { value: 4.2, unit: 'kWh/m²/day', seasonalSpread: 1.1, source },
      pressureKpa: { value: 0.62, unit: 'kPa', seasonalSpread: 0.08, source }
    },
    completeness: { temp: '25/25 seasonal samples', solar: '25/25 seasonal samples', pressure: '25/25 seasonal samples' }
  };
  const target = {
    id: 'picked-mars-3.830--17.507', body: 'mars', custom: true, measurementStatus: 'validated',
    measurements: payload, v: { temp: payload.values.temp, solar: payload.values.solar }
  };

  assert.equal(validateMarsPointResponse(payload).valid, true);
  const ranked = rankMeasuredMarsPoint(target, ANALOGS, PRESETS[0].w);
  assert.ok(ranked.length > 0);
  assert.equal(ranked[0].targetId, target.id);
  assert.ok(ranked[0].matchedFeatures.includes('temp'));
  assert.ok(ranked[0].matchedFeatures.includes('solar'));
  assert.ok(ranked[0].warnings.some((warning) => /modelled climatology, not direct in-situ observations/i.test(warning)));
  const tempOnly = rankMeasuredMarsPoint(target, ANALOGS, { temp: 100, solar: 0, ice: 0, soil: 0, terrain: 0, dry: 0, tube: 0 });
  const solarOnly = rankMeasuredMarsPoint(target, ANALOGS, { temp: 0, solar: 100, ice: 0, soil: 0, terrain: 0, dry: 0, tube: 0 });
  assert.notEqual(tempOnly[0].analog.id, solarOnly[0].analog.id, 'weights must change the nearest ranked site');

  const stale = { ...target, v: { temp: { value: -10 }, solar: payload.values.solar } };
  assert.deepEqual(rankMeasuredMarsPoint(stale, ANALOGS, PRESETS[0].w), []);
  const incomplete = { ...payload, completeness: { ...payload.completeness, temp: '2/25 seasonal samples' } };
  assert.equal(validateMarsPointResponse(incomplete).valid, false);
  assert.deepEqual(rankMeasuredMarsPoint({ ...target, measurements: incomplete }, ANALOGS, PRESETS[0].w), []);
});

test('MCD seasonal ASCII output is parsed as sourced numeric measurements', () => {
  const rows = Array.from({ length: 12 }, (_, index) => `${(index * 30).toFixed(2).padStart(15)}${(210 + index).toFixed(5).padStart(15)}`).join('\n');
  const ascii = `### Column 1 is Areocentric longitude (degrees)\n### Column 2 is Surface temperature (K)\n${rows}\n`;
  const series = parseMcdSeries(ascii);
  assert.equal(series['Surface temperature (K)'].length, 12);
  const summary = summarizeMcdSeries(series, /surface temperature \(k\)/i);
  assert.equal(summary.count, 12);
  assert.equal(summary.mean, 215.5);
  assert.equal(summarizeMcdSeries(series, /surface pressure \(pa\)/i), null);
});

test('every target measurement carries a value, uncertainty and source', () => {
  for (const target of TARGETS) {
    for (const feature of FACTORS) {
      const value = target.v[feature.k];
      assert.ok(value != null, `${target.id} missing ${feature.k}`);
      if (typeof value === 'number') {
        assert.ok(Number.isFinite(value));
        continue;
      }
      assert.equal(typeof value, 'object', `${target.id}.${feature.k}`);
      assert.ok(Number.isFinite(value.value), `${target.id}.${feature.k} value`);
      assert.ok(Number.isFinite(value.uncertainty), `${target.id}.${feature.k} uncertainty`);
      assert.ok(value.source && value.source.name, `${target.id}.${feature.k} source`);
    }
  }
});

test('the committed discovery snapshot satisfies its module contract', () => {
  assert.equal(DISCOVERY.schema, 'astra.discovery/1');
  assert.equal(DISCOVERY.engineVersion, ENGINE_VERSION);
  assert.equal(DISCOVERY.configVersion, CONFIG_VERSION);
  assert.equal(ANALOGS, DISCOVERY.candidates);
  assert.ok(ANALOGS.length > 0);
  assert.ok(Array.isArray(DISCOVERY.sources) && DISCOVERY.sources.length >= 5);

  const ids = new Set();
  for (const candidate of ANALOGS) {
    assert.ok(!ids.has(candidate.id), `duplicate ${candidate.id}`);
    ids.add(candidate.id);
    assert.equal(candidate.discovered, true);
    assert.ok(candidate.name && candidate.region);
    assert.ok(Number.isFinite(candidate.lat) && candidate.lat >= -90 && candidate.lat <= 90);
    assert.ok(Number.isFinite(candidate.lon) && candidate.lon >= -180 && candidate.lon <= 180);
    assert.ok(['High', 'Medium', 'Low'].includes(candidate.conf));
    assert.ok(candidate.v.temp && candidate.v.solar && candidate.v.dry);
    assert.ok(Array.isArray(candidate.provenance) && candidate.provenance.length >= 3);
    for (const entry of candidate.provenance) {
      assert.ok(entry.source && entry.source.id, `${candidate.id} provenance source`);
      assert.ok(Number.isFinite(entry.value), `${candidate.id} ${entry.key} value`);
    }
  }
});

test('every target can be scored against the discovered snapshot', () => {
  for (const target of TARGETS) {
    const ranked = rankAnalogs(target, ANALOGS, PRESETS[0].w);
    assert.equal(ranked.length, ANALOGS.length);
    assert.ok(Number.isFinite(ranked[0].total));
    assert.ok(ranked[0].coverage > 0);
    assert.ok(['ok', 'insufficient_coverage'].includes(ranked[0].status));
  }
});

test('display formatting handles real units and missing values', () => {
  assert.equal(fmt('temp', -183), '−183 °C');
  assert.equal(fmt('solar', 6.65), '6.7 kWh/m²/day');
  assert.equal(fmt('ice', 80), '80 / 100');
  assert.equal(fmt('ice', null), 'no data');
  assert.equal(fmtUncertainty('temp', { uncertainty: 18 }), '±18 °C');
  assert.equal(fmtUncertainty('solar', { uncertainty: 0.6 }), '±0.6 kWh/m²/day');
  assert.equal(fmtCoords(-20, -70), '20.0°S 70.0°W');
});

/* ------------------------------------------------------------------ */
/* Planetary point-probe derivations and scientific-data gates          */
/* ------------------------------------------------------------------ */

const source = (id, name, url = 'https://trek.nasa.gov/moon/') => ({
  id, name, url, period: 'Mission product', resolution: 'Mapped product', evidenceType: 'remote_sensing'
});

function moonProbe() {
  const dem = source('lro-lola-dem-256ppd', 'LRO LOLA DEM');
  const diviner = source('lro-diviner-hourly', 'LRO Diviner');
  const feo = source('kaguya-mi-feo', 'Kaguya MI FeO');
  const solar = source('nasa-moon-solar-constant', 'NASA Moon Fact Sheet solar constant');
  const vacuum = source('nasa-moon-fact-sheet', 'NASA Moon Fact Sheet');
  const values = {
    temp: { value: -64.57, uncertainty: 5, unit: '°C', source: diviner },
    solar: { value: 10.398, uncertainty: 2.6, unit: 'kWh/m²/day', source: solar },
    dry: { value: 100, uncertainty: 0, unit: 'index', source: vacuum },
    soil: { value: 76.7, uncertainty: 8, unit: 'index', source: feo },
    terrain: { value: 14.4, uncertainty: 15, unit: 'index', source: dem, elevationM: -720.5, reliefM: 144 },
    ice: null
  };
  return {
    schema: 'astra.planetary-probe/1',
    body: 'moon',
    lat: 0,
    lon: 0,
    dataset: 'NASA Moon Trek point probe',
    source: { id: 'astra-moon-point-probe', name: 'NASA Moon Trek', url: 'https://trek.nasa.gov/moon/', period: 'Mission products', resolution: 'Mapped', evidenceType: 'remote_sensing' },
    sources: [dem, diviner, feo, solar, vacuum],
    values,
    completeness: {
      temp: '8/8 local-hour samples',
      solar: 'geometric estimate',
      dry: 'reference value',
      soil: 'single mapped pixel',
      terrain: '9/9 DEM samples',
      ice: 'not queried: no reliable global lunar volatile point product connected',
      tube: 'not available: no global mapped cave/tube point product'
    },
    warnings: ['No global lunar volatile/ice point product is connected.'],
    presentFeatures: Object.entries(values).filter(([, value]) => value && Number.isFinite(value.value)).map(([key]) => key),
    retrievedAt: '2026-11-15T00:00:00.000Z'
  };
}

function marsProbe() {
  const mola = source('mars-mola-128-64', 'Mars MOLA DEM', 'https://trek.nasa.gov/mars/');
  const geology = source('usgs-sim3292-geology', 'USGS SIM3292 geology', 'https://trek.nasa.gov/mars/');
  const mcd = source('mars-climate-database-6.2', 'Mars Climate Database v6.2', 'https://www-mars.lmd.jussieu.fr/mars/access');
  const mcdSolar = source('mars-climate-database-solar', 'MCD surface solar flux', 'https://www-mars.lmd.jussieu.fr/mars/access');
  const mcdWater = source('mars-climate-database-water', 'MCD surface H2O layer', 'https://www-mars.lmd.jussieu.fr/mars/access');
  const mcdVapour = source('mars-climate-database-vapour', 'MCD water-vapour column', 'https://www-mars.lmd.jussieu.fr/mars/access');
  const values = {
    temp: { value: -2.51, uncertainty: 2.36, unit: '°C', source: mcd },
    solar: { value: 11.597, uncertainty: 0.34, unit: 'kWh/m²/day', source: mcdSolar },
    pressureKpa: { value: 0.728, uncertainty: 0.019, unit: 'kPa', source: mcd },
    ice: { value: 0, uncertainty: 8, unit: 'index', source: mcdWater },
    dry: { value: 93.5, uncertainty: 5, unit: 'index', source: mcdVapour },
    soil: { value: 55, uncertainty: 25, unit: 'index', source: geology },
    terrain: { value: 16.2, uncertainty: 15, unit: 'index', source: mola, elevationM: -2645, reliefM: 162 }
  };
  return {
    schema: 'astra.planetary-probe/1',
    body: 'mars',
    lat: 18.38,
    lon: 77.58,
    dataset: 'NASA Mars Trek + Mars Climate Database point probe',
    source: { id: 'astra-mars-point-probe', name: 'NASA Mars Trek + MCD', url: 'https://trek.nasa.gov/mars/', period: 'MOLA/SIM3292 mission maps; MCD v6.2 climatology', resolution: 'DEM 128/64 ppd; global geologic units; MCD model grid', evidenceType: 'remote_sensing_and_modelled_climatology' },
    sources: [mola, geology, mcd, mcdSolar, mcdWater, mcdVapour],
    values,
    completeness: {
      temp: '25/25 seasonal samples',
      solar: '25/25 seasonal samples',
      pressure: '25/25 seasonal samples',
      ice: '25 seasonal samples',
      dry: '25 seasonal samples',
      soil: 'single mapped polygon',
      terrain: '9/9 DEM samples',
      tube: 'not available: no global mapped cave/tube point product'
    },
    warnings: ['MCD is a model climatology, not a direct surface station measurement.'],
    presentFeatures: Object.entries(values).filter(([, value]) => value && Number.isFinite(value.value)).map(([key]) => key),
    retrievedAt: '2026-11-15T00:00:00.000Z'
  };
}

test('relief, illumination and composition helpers are transparent derivations', () => {
  assert.equal(reliefIndex([1, 2, 3, 4]), null);
  const relief = reliefIndex([0, 900, 0, 0, 0, 0, 0, 0, 0]);
  assert.equal(relief.value, 90);
  assert.equal(relief.reliefM, 900);
  assert.equal(relief.count, 9);
  assert.ok(Math.abs(relief.stdDevM - 282.8) < 0.1);

  assert.equal(moonSolarEstimate(0).value, 10.398);
  assert.equal(moonSolarEstimate(90).value, 0);
  assert.equal(moonSolarEstimate(NaN), null);

  assert.ok(Math.abs(moonFeoProxy(5.76154).value - 28.8) < 0.1);
  assert.ok(Math.abs(moonFeoProxy(19.63).value - 98.1) < 0.2);
  assert.equal(moonFeoProxy(50), null);

  assert.equal(marsGeologyProxy('Ah', 'Amazonian volcanic flow').value, 92);
  assert.equal(marsGeologyProxy('HNt', 'Cratered highland terrain').value, 55);
  assert.equal(marsGeologyProxy('Api', 'polar ice and frost').value, 15);
  assert.equal(marsGeologyProxy('Xyz', 'undivided material').value, 45);
  assert.equal(marsGeologyProxy('', ''), null);
});

test('water and aridity helpers keep units and evidence classes explicit', () => {
  const wet = marsIceEvidence(6.8, 7.0);
  assert.equal(wet.value, 100);
  assert.equal(wet.evidenceClass, 3);
  const trace = marsIceEvidence(0.01, 0.02);
  assert.ok(trace.value < 1);
  assert.equal(trace.evidenceClass, 0);
  assert.equal(marsIceEvidence(-1), null);

  assert.equal(marsDryness(0.2).value, 0);
  assert.ok(Math.abs(marsDryness(0.0129).value - 93.5) < 0.1);
  assert.equal(marsDryness(-0.1), null);

  assert.equal(mcdColumn({ 'Surface temperature (K)': [{ coordinate: 0, value: 210 }] }, /surface temperature/i).length, 1);
  assert.equal(mcdColumn({ 'Surface temperature (K)': [] }, /pressure/i), null);
});

test('polar stereographic coordinates round-trip the sign convention', () => {
  const north = polarXY(85, 0);
  assert.equal(north.wkid, 0);
  assert.ok(Math.abs(north.x) < 1e-9);
  assert.ok(Math.abs(north.y + 151713.04) < 0.1);
  const south = polarXY(-85, 0);
  assert.ok(Math.abs(south.y - 151713.04) < 0.1);
  assert.equal(polarXY(NaN, 0), null);
});

test('Moon and Mars probes pass the provenance and range gates', () => {
  const moon = moonProbe();
  const moonCheck = validatePointProbe(moon, 'moon');
  assert.equal(moonCheck.valid, true, moonCheck.errors.join('; '));

  const mars = marsProbe();
  const marsCheck = validatePointProbe(mars, 'mars');
  assert.equal(marsCheck.valid, true, marsCheck.errors.join('; '));
});

test('probe validation rejects out-of-range, unprovenanced and under-sampled values', () => {
  const outOfRange = moonProbe();
  outOfRange.values.temp.value = 500;
  assert.equal(validatePointProbe(outOfRange, 'moon').valid, false);

  const noSources = moonProbe();
  noSources.sources = [];
  assert.equal(validatePointProbe(noSources, 'moon').valid, false);

  const invented = moonProbe();
  invented.values.magic = { value: 1, uncertainty: 0, unit: 'index', source: invented.sources[0] };
  assert.equal(validatePointProbe(invented, 'moon').valid, false);

  const underSampled = marsProbe();
  underSampled.completeness.temp = '2/25 seasonal samples';
  assert.equal(validatePointProbe(underSampled, 'mars').valid, false);

  const presentButUnavailable = moonProbe();
  presentButUnavailable.completeness.temp = 'unavailable';
  assert.equal(validatePointProbe(presentButUnavailable, 'moon').valid, false);
});

test('only a fresh, validated Moon or Mars probe can be ranked', () => {
  const payload = moonProbe();
  const target = {
    id: 'picked-moon-0-0', body: 'moon', custom: true, lat: 0, lon: 0,
    measurementStatus: 'validated', measurements: payload,
    v: Object.fromEntries(Object.entries(payload.values).filter(([, value]) => value && Number.isFinite(value.value)))
  };
  const ranked = rankMeasuredPoint(target, ANALOGS, PRESETS[0].w);
  assert.ok(ranked.length > 0);
  assert.equal(ranked[0].targetId, target.id);
  assert.ok(ranked[0].matchedFeatures.includes('temp'));
  assert.ok(ranked[0].matchedFeatures.includes('terrain'));

  assert.deepEqual(rankMeasuredPoint({ ...target, measurementStatus: 'loading' }, ANALOGS, PRESETS[0].w), []);
  assert.deepEqual(rankMeasuredPoint({ ...target, body: 'earth' }, ANALOGS, PRESETS[0].w), []);
  assert.deepEqual(rankMeasuredPoint({ ...target, lat: 1 }, ANALOGS, PRESETS[0].w), []);
  assert.deepEqual(rankMeasuredPoint({ ...target, v: { ...target.v, temp: { value: -10 } } }, ANALOGS, PRESETS[0].w), []);
});

test('Earth coordinate scores require current validated NASA POWER observations', () => {
  const root = 'https://power.larc.nasa.gov/';
  const ref = 'https://power.larc.nasa.gov/api/temporal/climatology/point?latitude=12&longitude=34';
  const measured = (value, id, unit) => ({ value, uncertainty: 1, unit, source: { id, url: ref } });
  const payload = {
    dataset: 'NASA POWER / MERRA-2',
    retrievedAt: new Date().toISOString(),
    coordinate: { latitude: 12, longitude: 34 },
    source: { name: 'NASA POWER / MERRA-2 climatology', url: root, reference: ref, observationPeriod: '2001-2025', resolution: 'Approximately 0.5° native model grid; coordinate values are grid-resampled.' },
    features: {
      temp: measured(18, 'nasa-power-ts', '°C'),
      solar: measured(4.5, 'nasa-power-solar', 'kWh/m²/day'),
      ice: measured(0, 'nasa-power-water', 'index'),
      dry: measured(45, 'nasa-power-dryness', 'index'),
      soil: null, terrain: null, tube: null
    },
    completeness: { temp: 'measured', solar: 'measured', ice: 'measured', dry: 'measured', soil: 'unavailable', terrain: 'unavailable', tube: 'unavailable' }
  };
  const point = {
    id: 'picked-earth-12-34', body: 'earth', custom: true, lat: 12, lon: 34,
    measurementStatus: 'validated', measurements: payload, v: payload.features
  };
  assert.equal(validateEarthPointResponse(payload, 12, 34).valid, true);
  assert.ok(rankMeasuredEarthPoint(TARGETS[0], point, PRESETS[0].w).length > 0);
  assert.deepEqual(rankMeasuredEarthPoint(TARGETS[0], { ...point, lon: 35 }, PRESETS[0].w), []);
  assert.deepEqual(rankMeasuredEarthPoint(TARGETS[0], { ...point, v: { ...point.v, temp: measured(19, 'nasa-power-ts', '°C') } }, PRESETS[0].w), []);
  const incomplete = structuredClone(payload);
  incomplete.completeness.temp = 'unavailable';
  assert.equal(validateEarthPointResponse(incomplete, 12, 34).valid, false);
  assert.deepEqual(rankMeasuredEarthPoint(TARGETS[0], { ...point, measurements: incomplete }, PRESETS[0].w), []);
});
