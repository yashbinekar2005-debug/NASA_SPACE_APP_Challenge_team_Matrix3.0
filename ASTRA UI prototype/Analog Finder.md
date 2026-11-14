# Analog Finder

Earth test sites that stand in for Moon and Mars bases

Prototype · sample data

Step 1 · Space target

Step 2 · What matters most

Indexes run from 0 (none) to 100 (very strong).

Drag a globe to rotate · click a pin to select

Selected pair

0%

Step 3 · Best Earth matches

## Ranked sites

Small bars show how well each factor matches, left to right: temperature, ice, soil, terrain, dryness, lava tube.

How the score works

- Each factor becomes a bounded distance between 0 and 1.
- Temperature uses a 200 °C cap; the 0 to 100 factors use their own scale.
- Similarity = 100 × (1 − weighted mean distance); your sliders set the weights.
- Missing or non-comparable factors are excluded and the remaining weights are renormalised; coverage is reported separately.
- Lava-tube access only counts when the target has a mapped tube or pit.
- Confidence combines coverage, documentation quality and cross-body comparability. It is not the same thing as similarity.
- Earth's gravity, air and magnetic field are not modeled. No site can match them.

All numbers here are illustrative placeholders for a design prototype. Before use, replace them with real datasets such as LOLA (Moon), HiRISE and MOLA (Mars) and USGS (Earth). Terrain previews are generated shapes, not real elevation data.