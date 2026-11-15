# 🌍 NASA Planetary Analog Location Finder

### Finding Earth Locations That Resemble the Moon and Mars Using NASA Data, Geospatial Analysis & Artificial Intelligence

## 🚀 Project Overview

The **NASA Planetary Analog Location Finder** is a geospatial intelligence platform designed to identify and rank locations on Earth that share similar geological, topographical, thermal, and environmental characteristics with selected regions of the Moon and Mars.

The project uses scientific datasets collected from NASA APIs, the Planetary Data System (PDS), NASA Earthdata, and other relevant scientific data providers.

By analyzing regional characteristics such as elevation, terrain roughness, slope, surface temperature, water availability, ice indicators, and mineral composition, the system calculates similarity scores and identifies potential Earth analog locations.

The ultimate goal is to help researchers, scientists, and space exploration teams identify suitable terrestrial environments for planetary research, astronaut training, habitat 
testing, and rover experiments.

### AI Usage Disclosure

- OpenAI Codex: Used for UI development, code debugging, and data optimization.

- OpenCode: Used for developing and refining the platform's core algorithms.

AI tools were used to assist development and improve efficiency. The overall project concept, integration, and implementation were guided by the development team.

---


## 🎯 Project Objectives

- Identify Earth regions that resemble selected areas of the Moon and Mars.
- Collect regional planetary and terrestrial datasets through scientific APIs and archives.
- Analyze water presence, temperature, terrain, and geological characteristics.
- Develop a mathematical similarity algorithm to compare planetary regions.
- Rank Earth locations according to their similarity to the selected planetary target.
- Provide transparent similarity scores and feature-by-feature explanations.
- Integrate Machine Learning where it demonstrably improves prediction and ranking.
- Visualize results through an interactive geospatial interface.

---

## 🪐 Planetary Bodies Under Analysis

| Planetary Body | Data to Analyze |
|---|---|
| 🌍 Earth | Temperature, surface water, soil moisture, elevation, slope, roughness, minerals |
| 🌕 Moon | Lunar elevation, surface temperature, craters, hydrogen and water-ice indicators |
| 🔴 Mars | Elevation, surface temperature, thermal inertia, hydrated minerals, water-ice indicators |

## 🔬 Key Comparison Parameters

The system will initially focus on the following characteristics:

| Parameter | Description | Importance |
|---|---|---|
| Water / Ice Evidence | Surface water, soil moisture, ice and volatile indicators | High |
| Temperature | Regional surface temperature and temperature variation | High |
| Elevation | Height and regional topography | High |
| Slope | Surface inclination | High |
| Terrain Roughness | Surface irregularity and ruggedness | High |
| Mineral Composition | Geological and mineralogical similarity | Medium |
| Crater Density | Number and distribution of impact craters | Medium |
| Surface Albedo | Surface reflectivity | Medium |

**Scientific consideration:** Water measurements differ across planetary bodies. Earth's soil moisture, Mars' hydrogen indicators, and lunar neutron measurements cannot be treated as identical quantities. The system will preserve their original measurement types and uncertainties.

---

## 🛰️ Data Sources & APIs

The project will use official scientific datasets and APIs wherever possible.

| Data Provider | Purpose |
|---|---|
| [NASA API](https://api.nasa.gov/) | Access supported NASA APIs |
| [NASA PDS](https://pds.nasa.gov/) | Moon and Mars planetary mission datasets |
| [NASA Earthdata](https://www.earthdata.nasa.gov/) | Earth observation datasets |
| [NASA CMR](https://cmr.earthdata.nasa.gov/) | Scientific dataset discovery |
| [NASA GIBS](https://www.earthdata.nasa.gov/data/tools/gibs) | Satellite imagery visualization |
| [NASA SMAP](https://smap.jpl.nasa.gov/) | Earth soil moisture |
| [NASA LOLA](https://science.nasa.gov/mission/lro/) | Lunar elevation and topography |
| [NASA Diviner](https://science.nasa.gov/mission/lro/) | Lunar thermal measurements |
| [NASA MOLA](https://pds-geosciences.wustl.edu/) | Mars elevation and topography |
| [NASA THEMIS](https://science.nasa.gov/mission/odyssey/) | Mars thermal observations |
| [NASA CRISM](https://science.nasa.gov/mission/mars-reconnaissance-orbiter/) | Mars mineralogical observations |

Additional datasets such as MODIS land surface temperature and JRC Global Surface Water may be integrated to improve Earth-side comparisons.

*Note: Not every dataset is accessible through a single API endpoint. Some require authentication, product downloads, and scientific raster processing.*

---

## 🧠 Algorithm Development

One of the most important parts of this project is developing a reliable algorithm that can identify the most similar Earth regions.

### Stage 1: Data Collection
- Retrieve regional data for Earth, Moon, and Mars.
- Collect temperature, water-related indicators, terrain, and geological information.
- Store original measurements with units, source metadata, and quality information.

### Stage 2: Data Preprocessing
- Handle missing values.
- Normalize measurements.
- Standardize units.
- Align geographic projections and spatial resolutions.
- Extract regional statistical features.

### Stage 3: Feature Extraction

Convert raw scientific datasets into structured numerical features.

Example:

```python
region_features = {
    "temperature_median": None,
    "temperature_range": None,
    "water_evidence": None,
    "elevation_median": None,
    "slope_mean": None,
    "terrain_roughness": None,
    "mineral_composition": None
}
```

Values will be populated from actual processed datasets, not manually assumed.

### Stage 4: Similarity Calculation

The initial algorithm will use a weighted distance-based similarity model.

**Weighted Euclidean Distance:**

\[
D = \sqrt{\sum_{i=1}^{n}w_i(x_i-y_i)^2}
\]

Where:

- \(x_i\): Target planetary feature.
- \(y_i\): Earth candidate feature.
- \(w_i\): Feature importance.
- \(D\): Weighted distance.

The final score will be calculated using normalized feature distances:

\[
Similarity = 100(1-D_{normalized})
\]

The normalized distance will be bounded between 0 and 1.

**Implementation note:** the first working baseline follows the more detailed
`plan.md` specification and uses a weighted mean of bounded per-feature
distances, not a raw Euclidean distance over unfiltered values:

\[
d_i = \min\left(1,\frac{|x_i-y_i|}{cap_i}\right), \qquad
D_j = \frac{\sum_i w_i d_{ij}}{\sum_i w_i}, \qquad
Similarity_j = 100(1-D_j)
\]

Only valid, comparable features contribute. Missing measurements are excluded
and the remaining weights are renormalised; coverage and confidence are reported
separately from similarity. Temperature, evidence-class and quantile-distribution
distances are supported.

The baseline is implemented in the ASTRA prototype:

- **Engine:** `ASTRA UI prototype/js/core/algorithm/`
- **UI facade:** `ASTRA UI prototype/js/core/scoring.js`
- **Specification:** `docs/algorithm.md`
- **Data dictionary:** `docs/data_dictionary.md`
- **Tests:** `node --test tests/algorithm.test.mjs` (run inside
  `ASTRA UI prototype/`)

The UI contract (`score`, `tier`, `rankAnalogs`, `{ total, parts }`) is
preserved. Results additionally expose coverage, confidence, profile scores,
per-feature distances, warnings, explanations, engine/config versions and a
reproducible run fingerprint.
