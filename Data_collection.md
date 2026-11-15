# ASTRA Data Collection

ASTRA combines Earth measurements with Moon and Mars data to compare selected locations. Each result should be interpreted alongside its source, observation period, resolution, uncertainty, and coverage. A similarity score is a screening result, not proof that two places are identical.

## Earth data

| Source | Data used | Access |
|---|---|---|
| [NASA POWER](https://power.larc.nasa.gov/) | Climate and environmental data, including temperature, precipitation, humidity, sunlight, soil wetness, snow, wind, pressure, and aerosol optical depth. The current climatology request covers 2001–2020. | Public API; no key required. |
| [ISRIC SoilGrids 2.0](https://soilgrids.org/) | Soil texture and properties such as clay, sand, silt, organic carbon, bulk density, and coarse fragments. ASTRA queries the 0–5 cm depth layer. | Public API; no key required. |
| [OpenTopoData SRTM](https://www.opentopodata.org/) | Elevation samples used to estimate local relief and terrain roughness. SRTM coverage is limited near the poles. | Public API; an optional OpenTopoData key can raise usage limits. |
| [Macrostrat](https://macrostrat.org/) | Mapped geologic units, lithology, and age. Map scale varies by location. | Public API; no key required. |
| [OpenStreetMap Overpass](https://overpass-api.de/api/interpreter) | Mapped cave entrances, used only as an incomplete capability proxy. No mapped entrance does not mean there is no cave. | Public API; no key required. |
| [BigDataCloud](https://www.bigdatacloud.com/) | Reverse geocoding for human-readable place labels. These labels do not affect similarity scores. | Public API; no key required. |

Earth candidates come from a sampled screening grid built from available datasets. The grid is not a measurement of every location on Earth. Its snapshot is stored in `js/data/discovered.js` and can be regenerated with `node tools/discover.mjs`.

## Moon data

| Source | Data used |
|---|---|
| [NASA Moon Trek](https://trek.nasa.gov/moon/) | LRO LOLA topography for elevation and local relief; Kaguya MI FeO mapping for a labeled composition proxy. |
| [LRO Diviner](https://www.diviner.ucla.edu/science) | Annual-average surface temperatures by local solar hour. |
| [NASA Moon Fact Sheet](https://nssdc.gsfc.nasa.gov/planetary/factsheet/moonfact.html) | Reference values for solar input and the Moon’s negligible atmosphere. Solar illumination is a geometric estimate, not a local measurement. |

## Mars data

| Source | Data used |
|---|---|
| [NASA Mars Trek](https://trek.nasa.gov/mars/) | MOLA topography for elevation and local relief. |
| [USGS SIM 3292](https://pubs.usgs.gov/sim/3292/) | Global mapped geology. Values derived from geologic units are proxies, not direct soil measurements. |
| [Mars Climate Database v6.2](https://www-mars.lmd.jussieu.fr/mars/access) | Modelled climate and seasonal atmospheric or volatile fields. These are model outputs, not in-situ readings. |

Moon and Mars named-feature searches use the [USGS/IAU Gazetteer of Planetary Nomenclature](https://planetarynames.wr.usgs.gov/GIS_Downloads).

## Imagery

- **Earth:** [NASA GIBS](https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi) provides MODIS true-color composites. Dates and local coverage vary; clouds can obscure the surface.
- **Moon:** [NASA/JPL Trek](https://trek.nasa.gov/moon/) provides LRO WAC mosaic imagery.
- **Mars:** [NASA/JPL Trek](https://trek.nasa.gov/mars/) provides global and selected higher-resolution orbital imagery. Coverage and resolution vary by location.

Planetary mosaics are not same-day photographs. If imagery is unavailable for a selected coordinate, the app should report the coverage limitation rather than show an unrelated location as that site’s image.

## Credentials

Most listed data sources are public and do not require credentials.

- `NASA_EARTHDATA_TOKEN` is optional and is used by `/api/auth/status` to validate an Earthdata Login token. It does not currently authenticate NASA POWER requests or the imagery listed above.
- `OPEN_TOPO_DATA_API_KEY` is optional and can be sent to OpenTopoData to raise usage limits.
- NASA POWER does not require or use a `NASA_POWER_API_KEY`.
- Keep credentials in `.env` or the hosting provider’s secret settings. Never put token values in source files, client-side code, or this document.

## Validation and limitations

ASTRA should include source references and report unavailable measurements rather than inventing replacement values. It compares only compatible parameters; missing or incompatible values are excluded from scoring. Coverage and uncertainty should be considered alongside the score.

Earth’s gravity, atmosphere, radiation environment, magnetic field, and other planetary conditions cannot be reproduced by selecting an Earth location. The comparison should identify these differences and avoid implying that an Earth analog is an exact match.