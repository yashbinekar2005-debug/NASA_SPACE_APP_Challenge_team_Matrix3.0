# Analog Similarity Engine — Technical Specification

**Engine version:** 1.0.0  
**Config version:** 2026.11.1  
**Implementation:** `ASTRA UI prototype/js/core/algorithm/`  
**UI facade:** `ASTRA UI prototype/js/core/scoring.js`

This is the first release of the multi-criteria planetary analog engine. It is a
transparent, deterministic baseline. It does not train a model and it does not
claim that a high score proves habitability, resource availability or mission
suitability.

---

## 1. Analogy objective

The engine scores **surface + thermal + water/volatile + terrain** resemblance
between one selected Moon/Mars target region and Earth candidate regions.

It produces:

- a custom weighted score driven by the UI sliders;
- independent profile scores for thermal, terrain, geological, water/volatile,
  mission-operations and balanced-overall views;
- data coverage, confidence, per-feature contributions, warnings and a
  generated explanation.

Different analog objectives are not collapsed into one unexplained number.
Every profile reports its own caveats.

---

## 2. Core formula

For candidate `j` and feature `i`:

```
d_ij = min(1, |x_i − y_ij| / cap_i)          bounded per-feature distance
D_j  = Σ(w_i · d_ij) / Σ(w_i)                valid comparable features only
S_j  = 100 × (1 − D_j)                       similarity in [0, 100]
```

Where:

- `x_i` is the target feature;
- `y_ij` is the Earth candidate feature;
- `w_i` is the relative feature weight (not required to sum to 100);
- `cap_i` is the documented distance cap;
- features with no valid comparison are excluded from both numerator and
  denominator;
- weights are renormalised over the features that actually contribute.

This is algebraically equivalent to the original prototype formula for the
current numeric data, so existing rankings are preserved while the engine gains
explicit coverage, confidence and provenance.

### Why a bounded distance?

Raw metres, kelvin and 0–100 indexes are not commensurable. Each feature is
first converted to a bounded distance in `[0, 1]`. The cap is a scientific
choice, not a hidden normalization:

| Feature | Kind | Cap / scale | Notes |
|---|---|---:|---|
| Temperature | continuous | 200 °C | inherited from the prototype; a 200 °C gap scores 0 |
| Ice and water | index | 100 | proxy evidence index, not a water fraction |
| Volcanic soil | index | 100 | composition proxy |
| Terrain roughness | index | 100 | regional roughness proxy |
| Dryness | index | 100 | aridity proxy |
| Lava-tube access | capability | 100 | capability, not a difference |

The caps are deliberately visible and configurable in
`js/core/algorithm/features.js` (temperature cap lives on the feature record in
`js/data/factors.js`). They must be tested and revised with domain input before
publication.

---

## 3. Feature model and comparability

Each feature record carries:

```js
{
  k, label, hint,
  kind: 'continuous' | 'index' | 'capability',
  unit, family,
  distanceCap | scale,
  comparability: 0–1,
  evidenceType: 'measurement' | 'proxy' | 'capability',
  comparabilityNote
}
```

`comparability` is used **only for confidence**. It is deliberately
conservative: `1.0` would mean the same quantity is measured the same way on
Earth, the Moon and Mars, which is rarely true.

### Water/volatile rule

The engine never converts hydrogen, neutron or spectral evidence into a water
percentage. Values may be stored as:

- a numeric proxy index;
- an ordered evidence class (`0` none detected, `1` weak/ambiguous,
  `2` moderate, `3` strong, `unknown` no valid data);
- a measurement object containing the original value, uncertainty and source.

When both sides provide an ordered evidence class, distance is
`|class_target − class_candidate| / 3`. Otherwise the engine falls back to the
documented proxy index and emits a warning. “No evidence detected” is not
treated as proof of absence.

### Temperature rule

Temperature is stored in °C and documented alongside a Kelvin conversion.
The engine can compare either scalar regional statistics or matching quantile
distributions (for example `p10`, `p50`, `p90`). When both sides provide the
same probability levels:

```
d_temp = min(1, mean(|q_target,p − q_candidate,p|) / 200 °C)
```

This is a normalized 1-D Wasserstein distance. Mismatched quantile levels are
not compared.

### Capability rule

Lava-tube access is not a planetary difference. It is a capability offered by
the candidate. It participates only when the target has a mapped tube or pit
(`target.tube >= 50`). Otherwise the feature is marked `not_applicable`, its
weight is dropped, and the UI/report explains why.

---

## 4. Missing data and coverage

Rules:

1. Never replace a missing measurement with zero.
2. A feature participates only when the target and candidate are comparable.
3. Invalid features are removed from the weighted distance and the remaining
   weights are renormalised.
4. Coverage is reported separately:

```
coverage = Σ(valid requested weight) / Σ(requested weight)
```

5. If coverage is below `minCoverage` (default 0.5), the result is marked
   `insufficient_coverage` and a warning is emitted.
6. If fewer than `minFeatures` (default 2) features contribute, the result is
   marked `insufficient_features`.
7. If no weight is active, the status is `no_weights` and no misleading 0 %
   match is presented as a valid score.

Statuses: `ok`, `no_weights`, `no_comparable_features`,
`insufficient_coverage`, `insufficient_features`.

---

## 5. Confidence

Confidence answers a different question from similarity:

> How much of the requested comparison was actually available, how well are the
> sites documented, and how comparable are the measurements across bodies?

```
quality       = mean(documentation quality of target and candidate)
comparability = weight-averaged feature comparability
confidence    = 100 × coverage × quality × comparability
```

Documentation quality mapping:

| Label | Score |
|---|---:|
| High | 1.00 |
| Medium | 0.72 |
| Low | 0.45 |
| Unknown | 0.25 |

Confidence labels: `High` at ≥ 67, `Medium` at ≥ 42, otherwise `Low`.

A 90 % similarity based on two weak proxy features can therefore have low
confidence, while a 70 % similarity based on many well-documented features can
have higher confidence. The two numbers are never merged.

---

## 6. Score profiles

Profiles are fixed-weight views of the same per-feature distances. They do not
change the custom ranking.

| Profile | Weights | Purpose |
|---|---|---|
| `balanced_overall` | all comparable features = 1 | research overview |
| `thermal` | temperature = 1 | thermal analog |
| `terrain` | terrain = 1, soil = 0.5 | terrain/ground character |
| `geological` | soil = 1, terrain = 0.75, tube = 0.5 | composition and volcanic morphology |
| `water_volatile` | ice = 1, dry = 0.75 | water/volatile evidence |
| `mission_operations` | temp = 0.5, terrain = 1, tube = 1 | first-order operations view |

Every profile reports `score`, `coverage`, `confidence`, `status`, the features
used and a written caveat.

The `balanced_overall` score is labelled a research prototype until weights and
feature selection are validated with domain expertise.

---

## 7. Explanations and warnings

Explanations are generated from actual score components, never random text.
Each result exposes:

- `drivers`: highest-contribution features with target/candidate values,
  similarity, distance, weight share and comparability;
- `matchedFeatures`: features that contributed with non-zero weight;
- `excludedFeatures`: requested features that had no valid comparison;
- `warnings`: missing data, low coverage, proxy evidence, tube non-applicability,
  low documentation quality and overall-score caveats;
- `explanation`: a short deterministic sentence naming the closest agreement,
  largest gap, coverage and confidence.

The UI compare screen shows per-feature similarity, distance and weight, the
profile scores, coverage/confidence metrics and the warnings.

---

## 8. Determinism and reproducibility

- The engine is pure; no random values, no clock-dependent behaviour.
- `rankAnalogs` sorts by similarity, then confidence, then candidate id.
- Each result includes:
  - `engineVersion`;
  - `configVersion`;
  - `fingerprint` (FNV-1a hash of engine version, config version, target id,
    candidate id, profile and resolved weights).
- Same input + same configuration ⇒ same ranking and fingerprint.

The current implementation is JavaScript so it can run in the ASTRA prototype
with no backend. The formulas and configuration are language-neutral and can be
ported to Python/FastAPI without changing the data contract.

---

## 9. Plan-shaped API payload

`runSimilarity` returns a JSON-serializable structure that a future FastAPI
route can expose unchanged:

```js
import { runSimilarity } from './js/core/algorithm/engine.js';

const payload = runSimilarity({
  target: marsTarget,
  candidates: earthRegions,
  weights: { temp: 50, ice: 50, soil: 50, terrain: 50, dry: 50, tube: 50 },
  profile: 'custom',
  topK: 20,
  minCoverage: 0.5
});
```

Shape:

```json
{
  "target_body": "mars",
  "target_region_id": "jezero",
  "target_name": "Jezero Crater",
  "profile": "custom",
  "engine_version": "1.0.0",
  "config_version": "2026.11.1",
  "results": [
    {
      "rank": 1,
      "earth_region_id": "atacama",
      "similarity": 87.0,
      "data_coverage": 1.0,
      "confidence": 52.4,
      "confidence_label": "Medium",
      "status": "ok",
      "matched_features": ["temp", "ice", "soil", "terrain", "dry"],
      "excluded_features": [],
      "explanation": "Strong resemblance: …",
      "profiles": { "thermal": { "score": 87.0, "coverage": 1.0, "…": "…" } },
      "feature_contributions": [
        {
          "feature_id": "temp",
          "target_value": -60,
          "candidate_value": -20,
          "similarity": 80,
          "distance": 0.2,
          "weight": 50,
          "valid": true,
          "reason": null
        }
      ]
    }
  ],
  "warnings": ["…"]
}
```

The numbers above are illustrative; the current site values are still
prototype placeholders.

---

## 10. Ablation and validation hooks

`ablate(target, analogs, weights)` recomputes the ranking with each feature
removed and reports:

- whether the top-1 changed;
- mean absolute score delta;
- the new top-5.

This supports the plan’s Phase 5 validation work (feature ablation, weight
sensitivity, geographic holdouts). It is a diagnostic, not part of the UI
ranking path.

Recommended validation before publication:

1. Replace prototype values with documented regional products and provenance.
2. Review distance caps and weights with domain experts.
3. Compare rankings against documented analog sites (for example Askja, Devon
   Island, Atacama, Río Tinto, McMurdo Dry Valleys).
4. Run ablation, weight-sensitivity and resolution-sensitivity tests.
5. Document false positives and non-comparable measurements.
6. Only then consider learned weights or ML.

---

## 11. Scientific limitations

- Current values are illustrative prototype indexes, not calibrated mission
  data.
- Earth land-surface temperature, Martian surface/atmospheric temperature and
  lunar surface temperature are related but not identical measurements.
- Ice/water and dryness are proxies; a high score does not establish accessible
  liquid water or a usable volatile resource.
- Mineralogy and terrain are regional proxies, not spectral unmixing or
  traversability analysis.
- No illumination, communication, radiation, dust, gravity or atmosphere model
  is included.
- Similarity is relative to the selected features, caps and weights. It is not
  a universal scientific law.
- A high analog score does not establish habitability or mission suitability.

---

## 12. UI compatibility contract

The ASTRA prototype was treated as the design source of truth. The engine keeps
the original facade and result shape:

```js
score(target, analog, weights) // -> { total, parts }
rankAnalogs(target, analogs, weights)
tier(score)
```

Each `parts[i]` still contains `f`, `t`, `a`, `sim`, `wt`, `na`. New fields are
additive: `valid`, `applicable`, `d`, `weightShare`, `contribution`, `reason`,
`note`, evidence classes and raw measurement metadata.

The current prototype ranking is unchanged for the current numeric data because
the new distance forms are algebraically equivalent to the old formulas. New
UI elements (coverage, confidence, profiles, warnings) are additive and use the
existing theme tokens in `css/tokens.css`.

If the UI changes, keep these invariants:

1. `state.ranked` remains an array of `{ analog, total, parts }`.
2. `parts` remains ordered like `FACTORS`.
3. `total` remains a number in `[0, 100]`.
4. `f.k` remains one of `temp`, `ice`, `soil`, `terrain`, `dry`, `tube`.
5. The compare screen may rely on `r.coverage`, `r.confidence`,
   `r.confidenceLabel`, `r.profiles`, `r.warnings`, `r.explanation` and
   `r.status` being present.
