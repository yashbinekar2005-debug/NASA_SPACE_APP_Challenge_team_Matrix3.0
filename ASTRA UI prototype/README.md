# Analog Finder · ASTRA

An interactive front-end prototype that ranks **Earth analog test sites** against
**Moon and Mars exploration targets**, then explains the match side by side.

It is a static site: plain HTML, CSS and ES modules. No framework, no build step,
no runtime dependencies.

## What it does

- **Pick a measured target, or click anywhere** — choose a published Moon/Mars
  site, or click any visible point on the Moon/Mars globe to probe that exact
  coordinate.
- **Probe original NASA products** — LRO LOLA and Diviner, Kaguya MI, MOLA,
  USGS SIM3292 and the Mars Climate Database, through a small server-side
  proxy that avoids browser CORS limits.
- **Weight what matters** — seven factors (temperature, solar illumination, ice,
  soil, terrain, dryness, lava tubes) with four presets.
- **See the ranking** — Earth cells discovered from NASA POWER, SRTM, SoilGrids
  and Macrostrat are scored against the target and drawn as pins and arcs
  between the two software-rendered globes.
- **Compare side by side** — factor-level values, uncertainty, coverage,
  confidence, independent profile scores, weakest factors, missing-data
  warnings, provenance and the differences no Earth site can replicate.
- **Explain every score** — bounded per-feature distances, renormalised
  missing-data handling and a reproducible run fingerprint.

Globe textures and decorative terrain previews are generated in code. Custom
Moon/Mars points show their real 3×3 DEM samples instead of a generated scene.

## Run it locally

ES modules need a real web server; opening `index.html` straight from disk will not work.
The Node server is required for click-to-probe: it proxies NASA Trek and the
Mars Climate Database, which do not allow browser CORS requests.

```bash
node tools/serve.mjs
# then open http://localhost:4173
```

A plain static host (Python, `npx serve`, GitHub Pages) can still show the
pre-generated Earth discovery snapshot, but the live Moon/Mars probe routes
will be unavailable.

## Run the algorithm tests

The similarity engine is plain ES modules and has a Node test suite:

```bash
node --test tests/algorithm.test.mjs
```

The tests cover unit conversions, bounded distances, weighted renormalisation,
missing data, evidence classes, temperature distributions, confidence, profiles,
deterministic ranking, the plan-shaped API payload, probe derivations, polar
projection and the provenance/range gates for live Moon and Mars points.

## Deploy to GitHub Pages

1. Create a repository and push this folder.
2. On GitHub: **Settings → Pages → Build and deployment → Source: Deploy from a branch**.
3. Pick `main` and `/ (root)`, then save.
4. The site is served at `https://<user>.github.io/<repo>/`.

No workflow file or build action is needed.

GitHub Pages is static. It serves the committed Earth snapshot, but the
`/api/probe` and `/api/earth-point` routes need the Node server, so deploy
`tools/serve.mjs` to a Node host if live click-to-probe must work in production.

## Project structure

```
.
├── index.html                 # the app: header, Explore view, Compare mount point
├── Analog Finder.md           # text copy of the original design reference
├── assets/
│   └── favicon.svg            # brand mark
├── css/
│   ├── index.css              # entry point — imports the layers below in order
│   ├── tokens.css             # THEME: colours, type, accent + body modes
│   ├── base.css               # reset, document defaults, focus, reduced motion
│   ├── layout.css             # shell, header, panels, three-column Explore grid
│   ├── components.css         # buttons, target cards, sliders, stage, results
│   └── compare.css            # compare screen, facts, score bars, badges
└── js/
    ├── main.js                # controller: state changes, events, render loop, boot
    ├── data/
    │   ├── index.js           # public data API (lookups + re-exports)
    │   ├── factors.js         # the seven scoring dimensions
    │   ├── targets.js         # published Moon / Mars targets
    │   ├── discovered.js      # generated Earth-cell snapshot (committed)
    │   ├── planetary.js       # non-replicable planetary differences
    │   └── presets.js         # weight presets
    ├── core/
    │   ├── state.js           # the single mutable app state
    │   ├── research.js        # live-probe validation and fresh-point ranking
    │   ├── scoring.js         # public facade: score(), tier(), rankAnalogs()
    │   └── algorithm/         # the analog similarity engine
    │       ├── features.js    # feature model, profiles, versions
    │       ├── measurement.js # value / distribution / evidence normalisation
    │       ├── normalize.js   # clamps, quantiles, robust z, fingerprints
    │       ├── distance.js    # continuous, index, capability, distribution
    │       ├── confidence.js  # coverage, comparability and confidence
    │       ├── explain.js     # drivers, warnings and generated explanations
    │       └── engine.js      # score, rank, API payload, ablation
    ├── graphics/
    │   ├── rng.js             # deterministic seeded random
    │   ├── textures.js        # procedural Earth / Moon / Mars texture maps
    │   ├── globe.js           # software-rendered, lit, rotatable globe
    │   └── terrain.js         # procedural terrain preview + drag rotation
    ├── ui/
    │   ├── controls.js        # target cards, presets, sliders
    │   ├── results.js         # ranked list, pair bar
    │   ├── stage.js           # globes, pins, arcs, pointer interaction
    │   ├── compare.js         # compare screen, terrain lifecycle, copy summary
    │   └── views.js           # screen routing + URL hash
    └── utils/
        ├── dom.js             # $() helper, reduced-motion flag
        ├── format.js          # value formatting
        └── math.js            # TAU, angle wrap, smoothstep, clamp
```

Additional folders:

```
tests/
  algorithm.test.mjs          # Node test suite for the engine and live-probe gates
tools/
  serve.mjs                   # static server + /api/probe, /api/earth-point proxies
  discover.mjs                # regenerates js/data/discovered.js
  lib/planetary-probe.mjs     # NASA Trek + MCD point probes and derivations
  lib/features.mjs            # transparent Earth feature formulas
  lib/sources/                # POWER, SRTM, SoilGrids, Macrostrat, MCD adapters
docs/
  algorithm.md                # full similarity specification
  data_dictionary.md          # factor definitions and source notes
```

### Where to change things

| I want to… | Edit |
|---|---|
| Change colours, type, accent per body | `css/tokens.css` |
| Change spacing / grid / breakpoints | `css/layout.css` |
| Restyle a button, card, slider or result row | `css/components.css` |
| Restyle the compare screen | `css/compare.css` |
| Add or edit a space target | `js/data/targets.js` |
| Regenerate discovered Earth cells | `tools/discover.mjs` → `js/data/discovered.js` |
| Add a dimension to the score | `js/data/factors.js` + `js/core/algorithm/features.js` |
| Change distance caps, evidence rules or profiles | `js/core/algorithm/features.js` |
| Change the similarity/confidence math | `js/core/algorithm/engine.js`, `distance.js`, `confidence.js` |
| Add a weight preset | `js/data/presets.js` |
| Change ranking / selection behaviour | `js/main.js` |
| Change the Moon/Mars probe products | `tools/lib/planetary-probe.mjs` |
| Change live-probe validation | `js/core/research.js` |
| Replace the globes with real maps | `js/graphics/globe.js`, `js/graphics/textures.js` |

## Click-to-probe pipeline

Clicking a visible point on the Moon/Mars globe calls:

```http
GET /api/probe?body=moon&lat=-43.0&lon=0.67
GET /api/probe?body=mars&lat=18.38&lon=77.58
```

`tools/lib/planetary-probe.mjs` then reads original products through the server:

| Body | Product | What is used |
|---|---|---|
| Moon | NASA LRO **LOLA** DEM 256 ppd v06 | 9 elevations on a ~0.36° window → 0–100 relief |
| Moon | NASA **Diviner** annual average hourly maps | 8 local-hour samples → diurnal mean surface temperature |
| Moon | **Kaguya MI** FeO weight percent (±50°) | FeO → 0–100 mafic-soil proxy |
| Moon | NASA Moon Fact Sheet | solar constant geometry, vacuum reference |
| Mars | NASA **MOLA** 128/64 ppd merged DEM | 9 elevations → relief |
| Mars | USGS **SIM3292** global geology | mapped unit → 0–100 geological proxy |
| Mars | LMD/OU/IAA/ESA/CNES **Mars Climate Database v6.2** | 25 seasonal samples of temperature, pressure and surface shortwave flux; seasonal surface-H₂O layer and vapour column |

MCD is queried at **0 m above the local surface** (`zkey=3`); the CGI rejects
negative “above surface” altitudes, so the MOLA elevation is reported as
metadata instead of being passed as an altitude. MCD is a model climatology,
not a surface station measurement, and is labelled that way in the UI.

Every probe value carries a value, uncertainty, unit, source ID, HTTPS URL and
a completeness note. A failed product is returned as `null`, excluded from the
score, reflected in coverage, and listed in `warnings`. The pipeline never
substitutes latitude-based ice, a synthetic temperature or a guessed soil value.

Earth candidates come from the committed discovery snapshot
`js/data/discovered.js`, generated by `tools/discover.mjs` from NASA POWER
climate, 3×3 SRTM relief, SoilGrids texture and Macrostrat lithology. Regenerate
it with:

```bash
node tools/discover.mjs
```

Core probing is keyless. `OPEN_TOPO_DATA_API_KEY` is optional for heavier SRTM
use when regenerating the Earth snapshot; `.env.example` documents it. Live
probe responses are cached under `.cache/astra`, and the server keeps a short
in-process cache so re-rendering a selected point does not repeat every request.

## How the score works

The UI facade is still `js/core/scoring.js`; the implementation is
`js/core/algorithm/`. The original three exports are unchanged:

```js
score(target, analog, weights)   // -> { total, parts, ... }
tier(score)                      // -> "Strong match" etc.
rankAnalogs(target, analogs, weights)
```

For each candidate `j` and feature `i`:

```
d_ij = min(1, |target_i - candidate_i| / cap_i)     bounded distance
D_j  = Σ(w_i · d_ij) / Σ(w_i)                      valid comparable features only
S_j  = 100 × (1 − D_j)                             similarity
```

- **Temperature** uses a 200 °C cap, so a 200 °C gap scores 0.
- **0–100 factors** use their own 100-point scale.
- **Lava-tube access** is a capability, not a gap. It only participates when the
  target has a mapped tube (`target.tube >= 50`); otherwise it is reported as
  not applicable and its weight is dropped.
- **Missing data** is never replaced with zero. The feature is excluded and the
  remaining weights are renormalised.
- **Coverage** is the share of requested weight that had valid comparisons.
- **Confidence** is separate from similarity:
  `100 × coverage × documentation quality × weighted comparability`.
- **Profiles** (`thermal`, `terrain`, `geological`, `water_volatile`,
  `mission_operations`, `balanced_overall`) are fixed-weight views of the same
  distances. They do not change the custom ranking.
- **Same input, same output.** Each result carries an engine version, config
  version and fingerprint.

The engine also accepts richer values without breaking the UI:

```js
v: {
  temp: { value: -20, uncertainty: 2, source: 'MOLA-derived' },
  ice: { value: 70, evidenceClass: 2 },
  terrain: { quantiles: { p10: 40, p50: 55, p90: 70 } }
}
```

When both sides provide matching quantiles, temperature uses a normalized
Wasserstein distance. When both sides provide ordered evidence classes, the
ice/water proxy uses class distance instead of raw index distance.

See `docs/algorithm.md` and `docs/data_dictionary.md` for the full specification.

## Data note

Earth candidates are measured values from the committed discovery snapshot, and
clicked Moon/Mars points are probed live from the products listed above. Every
value keeps its source, unit, uncertainty and completeness note.

The engine is built for real measurements but is still a research prototype.
Its weights are not calibrated, several factors are documented 0–100 evidence
proxies rather than direct physical quantities, and a high similarity score is
not evidence that a site is habitable or mission-ready. Coverage and confidence
are reported separately from similarity.

Globe textures are generated shapes for design. Generated terrain previews are
used for published targets and Earth candidates; a clicked point shows its real
3×3 DEM sample instead.

## Known limitations / roadmap

- The globe stage is width-limited, so on wide screens it can leave a lot of empty space.
- The lava-tube factor is a capability score, not a distance like the other factors.
- The tube slider is dimmed but still movable when the target has no tube.
- All seven sliders at zero produce a 0 % score and a `no_weights` status.
- Globe pins are pointer-only; the ranked list is the keyboard path.
- The water/ice factor is an evidence proxy, not a water fraction.
- Lunar ice is not scored because no reliable global volatile point product is connected.
- Mars lava-tube access is not scored for arbitrary points because no global surveyed
  cave/tube point dataset exists.
- Lunar solar illumination is a latitude geometry estimate; slopes, horizons and
  permanent shadow are not modelled.
- Kaguya FeO coverage stops at ±50°, so soil is unavailable at high lunar latitudes.
- MCD is a model climatology. Its seasonal spread is not a published model error.
- SRTM 90 m is unavailable poleward of about 60°N / 56°S, so some Antarctic cells
  have no terrain value.
- Overpass cave queries are optional and may time out; the tube factor then uses
  the geology-only proxy.
- Candidate improvements: shareable URL state (`?target=…&weights=…`), keyboard
  navigation for the tab bar, calibrated weights from expert review, richer
  Earth coverage than the current coarse discovery grid, and a Python/FastAPI
  port of the same engine for server-side batch ranking.

## License

No license file yet — add one before publishing if you want others to reuse the code.
