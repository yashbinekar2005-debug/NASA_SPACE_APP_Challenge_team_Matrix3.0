# Analog Finder · ASTRA

An interactive front-end prototype that ranks **Earth analog test sites** against
**Moon and Mars exploration targets**, then explains the match side by side.

It is a static site: plain HTML, CSS and ES modules. No framework, no build step,
no runtime dependencies.

## What it does

- **Pick a target** — Shackleton Crater, Marius Hills Pit, Jezero Crater or Arsia Mons Skylights.
- **Weight what matters** — six factors (temperature, ice, soil, terrain, dryness, lava tubes)
  with four presets: balanced, rover drill, habitat shelter, ice mining.
- **See the ranking** — the ten Earth analogs are scored, sorted and drawn as pins and arcs
  between two software-rendered globes (Earth + Moon/Mars).
- **Compare side by side** — factor-by-factor score breakdown, coverage, confidence,
  independent profile scores, weakest factors, generated terrain previews and a copyable summary.
- **Explain every score** — bounded per-feature distances, renormalised missing-data handling,
  warnings and a reproducible run fingerprint.

Everything renders client-side. Textures, globes and terrain previews are generated in code.

## Run it locally

ES modules need a real web server; opening `index.html` straight from disk will not work.

```bash
# Option A — Python
python -m http.server 8000

# Option B — Node (no dependencies)
node tools/serve.mjs
# then open http://localhost:4173
```

Any equivalent works: `npx serve`, the VS Code **Live Server** extension, or GitHub Pages.

## Run the algorithm tests

The similarity engine is plain ES modules and has a Node test suite:

```bash
node --test tests/algorithm.test.mjs
```

The tests cover unit conversions, bounded distances, weighted renormalisation,
missing data, evidence classes, temperature distributions, confidence, profiles,
deterministic ranking and the plan-shaped API payload.

## Deploy to GitHub Pages

1. Create a repository and push this folder.
2. On GitHub: **Settings → Pages → Build and deployment → Source: Deploy from a branch**.
3. Pick `main` and `/ (root)`, then save.
4. The site is served at `https://<user>.github.io/<repo>/`.

No workflow file or build action is needed.

## Project structure

```
.
├── index.html                 # the app: header, Explore view, Compare mount point
├── Analog Finder.html         # original single-file design reference (not loaded by the app)
├── Analog Finder.md           # text copy of that design reference
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
    │   ├── factors.js         # the six scoring dimensions
    │   ├── targets.js         # Moon / Mars targets
    │   ├── analogs.js         # Earth analog sites
    │   └── presets.js         # weight presets
    ├── core/
    │   ├── state.js           # the single mutable app state
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
  algorithm.test.mjs          # Node test suite for the similarity engine
tools/
  serve.mjs                   # zero-dependency static server
```

### Where to change things

| I want to… | Edit |
|---|---|
| Change colours, type, accent per body | `css/tokens.css` |
| Change spacing / grid / breakpoints | `css/layout.css` |
| Restyle a button, card, slider or result row | `css/components.css` |
| Restyle the compare screen | `css/compare.css` |
| Add or edit a space target | `js/data/targets.js` |
| Add or edit an Earth analog site | `js/data/analogs.js` |
| Add a dimension to the score | `js/data/factors.js` + `js/core/algorithm/features.js` |
| Change distance caps, evidence rules or profiles | `js/core/algorithm/features.js` |
| Change the similarity/confidence math | `js/core/algorithm/engine.js`, `distance.js`, `confidence.js` |
| Add a weight preset | `js/data/presets.js` |
| Change ranking / selection behaviour | `js/main.js` |
| Replace the globes with real maps | `js/graphics/globe.js`, `js/graphics/textures.js` |
| Drop in real datasets | replace the arrays behind `js/data/index.js` |

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

All numbers are **illustrative placeholders for a design prototype**. Before any
real use they must be replaced with documented datasets such as LOLA (Moon),
MOLA/HiRISE (Mars) and USGS/NASA Earth observations. The globe textures and
terrain previews are generated shapes, not real elevation data, and the terrain
rotation is a visual affordance rather than a geographic view.

The engine is built for real measurements but does not pretend the current
numbers are calibrated. It preserves the original value, distribution,
evidence class, uncertainty and source when they are supplied, and it reports
coverage and confidence separately from similarity.

## Known limitations / roadmap

- The globe stage is width-limited, so on wide screens it can leave a lot of empty space.
- The lava-tube factor is a capability score, not a distance like the other factors.
- The tube slider is dimmed but still movable when the target has no tube.
- All six sliders at zero produce a 0 % score and a `no_weights` status.
- Globe pins are pointer-only; the ranked list is the keyboard path.
- Current feature values are still prototype indexes; the water/ice factor is a
  proxy, not a water fraction.
- Candidate improvements: shareable URL state (`?target=…&weights=…`), keyboard
  navigation for the tab bar, real DEM thumbnails, per-factor provenance panels,
  calibrated weights from expert review, and a Python/FastAPI port of the same
  engine for server-side batch ranking.

## License

No license file yet — add one before publishing if you want others to reuse the code.
