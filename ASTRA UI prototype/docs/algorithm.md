# Similarity algorithm

This document describes the scoring path implemented in
`js/core/algorithm/`. The public facade is `js/core/scoring.js`; the live
Moon/Mars point path is described at the end.

Engine version: `2.0.0` · config version: `2026.11.2`.

## Scope

The engine compares **measured values**, not site names or hand-written
scores. It answers one narrow question:

> Given the measurements available for a target and an Earth candidate, how
> close are the comparable values, and how much of the requested comparison was
> actually available?

It deliberately separates three quantities that are easy to confuse:

| Quantity | Question it answers | Where it appears |
|---|---|---|
| **Similarity** | How close are the comparable measurements? | `total`, 0–100 |
| **Confidence** | How complete, comparable and well documented is the evidence? | `confidence`, 0–100 |
| **Uncertainty** | How large is the propagated measurement error on the score? | `uncertainty.sigma`, `scoreInterval` |

A high similarity score with low confidence is a weak result, and the interface
shows both. Similarity is never adjusted to make a site look better.

## Measurement model

A site is a plain object with an `id`, a `body`, a `v` value map, and optional
documentation metadata such as `conf`.

`v` accepts several shapes per factor:

```js
v: {
  temp: -20,                                              // bare number
  ice: { value: 70, evidenceClass: 2 },                   // index + evidence class
  terrain: { value: 18, uncertainty: 10 },                // measurement + error
  solar: { quantiles: { p10: 5, p50: 6.2, p90: 7.1 } },   // distribution
  tube: null                                              // explicitly missing
}
```

`readMeasurement()` normalises each entry and preserves the original object,
source, uncertainty and evidence class. A value is **valid** when it has a
finite `value`/`median`/`mean`, a usable quantile set, or an evidence class.
Anything else is missing. Missing values are never replaced by zero.

## Factors

The seven factors are defined in `js/data/factors.js`.

| Key | Label | Unit | Kind | Cap / scale | Evidence |
|---|---|---|---|---|---|
| `temp` | Temperature | °C | continuous | 200 °C | measurement |
| `solar` | Solar illumination | kWh/m²/day | continuous | 12 | measurement |
| `ice` | Ice and water | index | index | 100 | proxy |
| `soil` | Volcanic soil | index | index | 100 | proxy |
| `terrain` | Terrain roughness | index | index | 100 | proxy |
| `dry` | Dryness | index | index | 100 | proxy |
| `tube` | Lava-tube access | index | capability | 100 | capability |

`comparability` (0–1) is a documented trust weight. It is used only for
confidence and uncertainty, never to change the distance.

## Per-factor distance

Every distance is bounded to `[0, 1]`, where `0` is a perfect match and `1` is
the documented cap or a full mismatch.

```
continuous     d = min(1, |t − a| / cap)
index          d = min(1, |t − a| / scale)
capability     d = min(1, 1 − candidate / scale)
evidence class d = min(1, |class_t − class_a| / 3)
distribution   d = min(1, mean_i |q_t,i − q_a,i| / cap)
```

Rules:

- A **distribution** distance (1-D Wasserstein over equal probability levels)
  is used only when **both** sides provide the same quantile levels. Otherwise
  the scalar value is used.
- For the `ice` proxy, when both sides expose an ordered `evidenceClass`
  (0 none … 3 strong), the engine compares classes instead of raw indexes.
  Class 0 means “no evidence detected in these datasets”, not proof of absence.
- The **capability** distance is not a planetary difference. It measures how
  much of a requested capability the candidate offers. A candidate at the
  scale scores 0; a candidate at 0 scores 1.
- `lava-tube access` only participates when the target itself has a mapped
  tube/pit (`target.tube ≥ 50`). Otherwise it is reported as not applicable and
  its weight is dropped.

## Aggregation

For candidate `j`:

```
D_j = Σ(w_i · d_ij) / Σ(w_i)      over applicable, valid features
S_j = 100 × (1 − D_j)
```

Weights are relative importances; only their ratios matter. If a factor is
missing, its weight leaves both the numerator and the denominator, and the
remaining weights are renormalised. `coverage` is reported separately as the
share of requested weight that had valid comparisons.

Ranking is deterministic:

1. higher `total`;
2. then higher `confidence`;
3. then ascending `analog.id`.

`rankAnalogs()` returns every candidate, including insufficient-data results,
so the UI can explain why a result is not usable.

## Status and coverage

Defaults: `minCoverage = 0.5`, `minFeatures = 2`, `tubeThreshold = 50`.

| Status | Meaning |
|---|---|
| `ok` | Enough coverage and enough valid features |
| `insufficient_coverage` | Less than 50 % of requested weight was comparable |
| `insufficient_features` | Fewer than two weighted features were valid |
| `no_comparable_features` | Nothing comparable after applicability |
| `no_weights` | Every requested weight is zero |

## Confidence

```
quality       = mean(CONFIDENCE_SCORE[target.conf], CONFIDENCE_SCORE[analog.conf])
comparability = weight-averaged factor comparability over valid parts
confidence    = 100 × coverage × quality × comparability
```

`CONFIDENCE_SCORE`: High `1`, Medium `0.72`, Low `0.45`, Unknown `0.25`.
Labels: High ≥ 67, Medium ≥ 42, otherwise Low.

The product is intentionally conservative: one weak indirect feature cannot
produce the same confidence as several direct, well-documented features.

## Score uncertainty

First-order propagation, per valid weighted factor `i`:

```
σ_d,i = hypot(σ_target,i, σ_candidate,i) / scale_i
σ_D   = sqrt( Σ (w_i / Σw)² · σ_d,i² + floor² )
σ_S   = 100 · σ_D
95 %  = clamp(S ± 1.96 · σ_S, 0, 100)
```

- For evidence-class comparisons, the class uncertainties are divided by 3.
- For capability factors, only the candidate capability uncertainty is used.
- Missing per-feature uncertainties fall back to documented defaults: 1 °C,
  0.3 kWh/m²/day, 5 index points, 8 capability points, 0.4 evidence class.
- `floor` is `0.015 + 0.05 × (1 − comparability)`. It documents cross-body
  model / instrument / spatial-scale mismatch. It is not random noise and it is
  not used to make a weak match look uncertain.
- Certainty is `clamp(100 − 2σ_S, 0, 100)`; labels: High ≥ 80, Medium ≥ 55.

Uncertainty describes the score, not the quality of the site.

## Fixed profiles

Profiles are independent fixed-weight views of the same per-feature distances.
They never change the custom ranking.

| Profile | Weights | Caveat |
|---|---|---|
| `balanced_overall` | all 1 | research prototype, not a habitability measure |
| `thermal` | temp 1, solar 1 | regional statistics, not local extremes |
| `terrain` | terrain 1, soil 0.5 | not a traversability analysis |
| `geological` | soil 1, terrain 0.75, tube 0.5 | proxies, no spectral unmixing |
| `water_volatile` | ice 1, dry 0.75 | does not establish accessible water |
| `mission_operations` | temp 0.5, solar 0.5, terrain 1, tube 1 | first-order only |

## Non-replicable differences

`js/data/planetary.js` lists six planetary properties that no Earth site can
reproduce: surface gravity, atmospheric pressure, radiation exposure, global
magnetic field, day–night cycle and atmosphere composition. Each has a source,
severity, consequence and mitigation. They are shown alongside every
comparison and are independent of the similarity score.

## Live Moon/Mars point probes

Clicking a Moon or Mars globe calls
`GET /api/probe?body=<moon|mars>&lat=…&lon=…`. The server runs
`tools/lib/planetary-probe.mjs`; `js/core/research.js` validates the response
before it can become a scoreable target.

The validation gates require:

- the documented probe schema, body and coordinate;
- the expected dataset and probe source ID;
- a finite, in-range value and correct unit for every present factor;
- an approved source ID and HTTPS URL per factor;
- a completeness entry per factor;
- at least two scoreable features;
- a non-empty approved source list;
- enough temperature samples (3/8 hourly for the Moon, 12/25 seasonal for Mars);
- a `presentFeatures` list that matches the values;
- a fresh `retrievedAt` timestamp.

A factor that fails or is outside product coverage is returned as `null`, named
in `warnings`, and excluded from the score. The UI lowers coverage and never
invents a substitute value. `rankMeasuredPoint()` additionally refuses to score
a point whose copied `target.v` values no longer match the validated payload.

See `docs/data_dictionary.md` for the product-level derivations.

## Reproducibility

Every result carries `engineVersion`, `configVersion` and a fingerprint over
the engine version, config version, target id, analog id, profile and resolved
weights. The same inputs produce the same output. The discovery snapshot also
records its generator, generation time, grid step and source list.

## Limitations

- Weights are not calibrated by expert review.
- Several factors are 0–100 evidence proxies, not direct physical quantities.
- Regional windows (3×3 DEM, climate cell) cannot resolve local micro-sites.
- Coverage and confidence describe available evidence; they are not a
  probability that a site is mission-suitable.
- Lava-tube access is a capability proxy, not a surveyed cave.
