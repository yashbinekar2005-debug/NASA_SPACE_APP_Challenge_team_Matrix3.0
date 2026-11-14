# Data Dictionary — Analog Features and Measurements

This dictionary defines the internal contract used by the similarity engine.
It is intentionally stricter than the current prototype data: real datasets can
be added without changing the algorithm or the ASTRA UI.

---

## 1. Feature record

Every regional feature should ultimately be traceable to a record like:

```js
{
  feature_id: 'temp',
  body: 'mars',
  region_id: 'jezero',
  value: -60,
  unit: '°C',
  measurement_type: 'regional_median_surface_temperature',
  distribution: { p10: -95, p50: -60, p90: -20 },
  depth_or_altitude: null,
  observation_start: '2018-01-01',
  observation_end: '2024-12-31',
  spatial_resolution_m: 100,
  temporal_resolution: 'seasonal_climatology',
  uncertainty: 5,
  quality_flag: 'good',
  evidence_class: null,
  source_dataset: 'THEMIS-derived product',
  source_product_id: '…',
  processing_version: 'v1',
  crs: 'IAU_MARS:2015',
  no_data_reason: null
}
```

The engine accepts a reduced form inside a site:

```js
{
  v: {
    temp: -60,                                  // scalar
    ice: { value: 12, evidenceClass: 1 },       // proxy + evidence class
    terrain: {                                   // distribution
      value: 45,
      quantiles: { p10: 30, p50: 45, p90: 70 }
    }
  }
}
```

`readMeasurement()` normalizes these forms and preserves `raw`, `uncertainty`,
`source` and `measurementType` for reporting.

---

## 2. Current feature set

| Key | Label | Kind | Unit | Cap/scale | Comparability | Evidence type |
|---|---|---|---|---:|---:|---|
| `temp` | Temperature | continuous | °C | 200 °C | 0.70 | measurement |
| `ice` | Ice and water | index | index | 100 | 0.50 | proxy |
| `soil` | Volcanic soil | index | index | 100 | 0.70 | proxy |
| `terrain` | Terrain roughness | index | index | 100 | 0.85 | proxy |
| `dry` | Dryness | index | index | 100 | 0.60 | proxy |
| `tube` | Lava-tube access | capability | index | 100 | 0.80 | capability |

`comparability` is a confidence input, not a similarity input. It must be
reviewed by domain experts before publication.

---

## 3. Body-specific measurement meanings

### Earth

| Feature | Candidate source | Meaning |
|---|---|---|
| Temperature | MODIS LST / MERRA-2 context | regional land-surface temperature statistics |
| Ice/water | JRC Global Surface Water, SMAP, snow/ice products | surface-water occurrence, soil moisture or snow/ice proxy |
| Soil | USGS/EMIT/geology products | composition proxy, not a global mineral map |
| Terrain | NASADEM/SRTM/Copernicus DEM derivatives | slope/roughness at a stated window |
| Dryness | aridity/soil-moisture products | aridity proxy |
| Tube | mapped lava tubes/caves | capability indicator |

### Moon

| Feature | Candidate source | Meaning |
|---|---|---|
| Temperature | LRO Diviner | surface temperature with local time/season metadata |
| Ice/water | LEND neutron, radar, PSR context | hydrogen/ice evidence, not water fraction |
| Soil | LROC/spectral products | regolith/composition proxy |
| Terrain | LOLA gridded products | elevation/slope/roughness |
| Dryness | thermal/volatile context | proxy |
| Tube | mapped pits/lava tubes | capability indicator |

### Mars

| Feature | Candidate source | Meaning |
|---|---|---|
| Temperature | THEMIS/MCS context | surface/atmospheric temperature with observation context |
| Ice/water | CRISM, GRS/neutron, SHARAD | hydrated mineral/ice evidence, not liquid water |
| Soil | CRISM/geology products | composition proxy |
| Terrain | MOLA gridded products | elevation/slope/roughness |
| Dryness | climate/thermal context | proxy |
| Tube | mapped skylights/pits | capability indicator |

---

## 4. Evidence classes

Use ordered classes only when the literature supports the mapping:

| Class | Meaning |
|---:|---|
| 0 | no evidence detected / below detection threshold (not proof of absence) |
| 1 | weak or ambiguous evidence |
| 2 | moderate evidence |
| 3 | strong evidence |
| `null` | no valid data / unknown |

Preserve the original measurement, unit and uncertainty next to the class. Do
not convert hydrogen signal, neutron suppression or a spectral index directly
into “water percentage”.

When both sides provide a class, the engine compares classes. Otherwise it
falls back to the documented proxy index and emits a warning.

---

## 5. Distributions

For temperature and other continuous variables, prefer distributions over a
single reading:

```js
quantiles: { p10: -95, p50: -60, p90: -20 }
```

Accepted forms:

- array of ordered quantiles `[p10, p50, p90]`;
- object with `p##` keys.

Both sides must use the same probability levels. Mismatched levels are not
compared, because interpolating one side would fabricate a distance.

The engine uses a normalized 1-D Wasserstein distance:

```
d = min(1, mean(|q_target,p − q_candidate,p|) / cap)
```

---

## 6. Missing data and quality

Required conventions:

- `null` / omitted = no valid measurement;
- never use `0` to mean “unknown”;
- record `no_data_reason` where known;
- retain `quality_flag`, `uncertainty`, `spatial_resolution_m` and time window;
- the engine excludes invalid features and reports coverage;
- confidence is reduced by missing data and low documentation quality.

---

## 7. Provenance and reproducibility

Every real feature should retain:

- source dataset and product id;
- processing version;
- observation window;
- native spatial/temporal resolution;
- CRS / planetary coordinate system;
- uncertainty and quality flags;
- licence/documentation URL.

The engine adds engine/config versions and a run fingerprint. A future backend
should store the full provenance alongside each run.

---

## 8. Current prototype data

`ASTRA UI prototype/js/data/targets.js` and `analogs.js` contain illustrative
0–100 indexes and °C values. They are not calibrated scientific measurements.
The engine treats their provenance as “prototype” and the UI labels them as
sample data. Replacing them with documented regional statistics is the next
scientific step.
