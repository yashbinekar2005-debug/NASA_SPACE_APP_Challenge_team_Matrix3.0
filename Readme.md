# ASTRA: Earth Analog Finder

ASTRA compares a selected Moon or Mars location with measured Earth data. It shows the measurements used, where they came from, how much evidence is available, and the limits of each comparison. A similarity score is a screening aid; it does not mean two locations are identical.

## Start ASTRA

Requirements: Node.js 18 or newer. The project does not require an npm install or build step.

From the `ASTRA UI prototype` folder, run:

```sh
node tools/serve.mjs
```

Open [http://localhost:4173](http://localhost:4173). Set `PORT` before starting if you need a different port. Live coordinate probes and API routes require the Node server; a static web host alone cannot run them.

## Data sources and URLs

The app retrieves data from public scientific services. The URLs below are the source pages or API endpoints used by the code. Some services provide point samples or map products, not a fresh measurement at every possible coordinate.

### Earth measurements and candidate discovery

| Dataset | What ASTRA uses it for | Source / API URL | Credentials |
| --- | --- | --- | --- |
| NASA POWER | Long-term climate and environmental values, including surface/air temperature, precipitation, humidity, sunlight, soil wetness, snow, wind, pressure, and aerosol optical depth. The climatology request covers 2001-2020. | [POWER API](https://power.larc.nasa.gov/api/temporal/climatology/point) · [POWER documentation](https://power.larc.nasa.gov/) | No key. `NASA_POWER_API_KEY` is not used and will not improve results. |
| ISRIC SoilGrids 2.0 | Topsoil properties (clay, sand, silt, organic carbon, bulk density, coarse fragments), queried at 0-5 cm depth. The mapped product is 250 m resolution. | [Point query API](https://rest.isric.org/soilgrids/v2.0/properties/query) · [SoilGrids](https://soilgrids.org/) | No key. |
| NASA SRTM through OpenTopoData | Elevation samples used to estimate local relief and terrain roughness. SRTM coverage is limited near the poles. | [SRTM 90 m API](https://api.opentopodata.org/v1/srtm90m) · [OpenTopoData](https://www.opentopodata.org/) | Public service works without a key. `OPEN_TOPO_DATA_API_KEY` is optional and is sent as a Bearer token. |
| Macrostrat | Mapped bedrock/geologic units, lithology, and age. Map scale varies by place. | [Geologic units API](https://macrostrat.org/api/geologic_units/map) · [Macrostrat](https://macrostrat.org/) | No key. |
| OpenStreetMap Overpass | Mapped cave entrances as an incomplete capability proxy. No mapped entrance does not prove that no cave exists. | [Overpass API](https://overpass-api.de/api/interpreter) · [OpenStreetMap](https://www.openstreetmap.org/) | No API key. `OVERPASS_URL` can select another Overpass endpoint. Set `ASTRA_CONTACT_EMAIL` to a real contact address for automated requests. |
| BigDataCloud reverse geocoding | Adds human-readable labels (locality, country, region) to coordinates. It does not affect the similarity score. | [Reverse geocoding API](https://api.bigdatacloud.net/data/reverse-geocode-client) · [BigDataCloud](https://www.bigdatacloud.com/) | No key. |

Earth discovery evaluates a sampled grid and stores its generated candidate snapshot in `ASTRA UI prototype/js/data/discovered.js`. It is not a live measurement of every point on Earth. Regenerate the snapshot from the project folder with:

```sh
node tools/discover.mjs
```

### Moon and Mars coordinate data

| Body / dataset | What ASTRA uses it for | Source |
| --- | --- | --- |
| Moon: NASA Lunar Reconnaissance Orbiter (LRO) LOLA global DEM | Elevation and local relief from the mapped topography product (256 pixels per degree; about 118 m at the equator). | [NASA Moon Trek](https://trek.nasa.gov/moon/) |
| Moon: LRO Diviner | Annual-average surface temperature by local solar hour. | [Diviner science](https://www.diviner.ucla.edu/science) |
| Moon: Kaguya Multiband Imager (MI) FeO map | Iron-oxide abundance used as a labeled composition proxy, not a direct soil-mechanics measurement. Its mapped coverage is limited by the product. | [NASA Moon Trek](https://trek.nasa.gov/moon/) |
| Moon: NASA Moon Fact Sheet | Reference values for the solar constant and negligible atmosphere; solar illumination is a geometric estimate. | [NASA Moon Fact Sheet](https://nssdc.gsfc.nasa.gov/planetary/factsheet/moonfact.html) |
| Mars: NASA Mars Trek / Mars Global Surveyor MOLA DEM | Elevation and local relief from the mapped topography product. | [NASA Mars Trek](https://trek.nasa.gov/mars/) |
| Mars: USGS SIM 3292 global geologic map | Mapped geology; any common-scale soil/geology value derived from a map unit is explicitly a proxy. | [NASA Mars Trek](https://trek.nasa.gov/mars/) · [USGS publication](https://pubs.usgs.gov/sim/3292/) |
| Mars: Mars Climate Database (MCD) v6.2 | Modelled Martian climate, including temperature and seasonal atmospheric/volatile fields. This is model output, not an in-situ reading at the selected point. | [MCD access and documentation](https://www-mars.lmd.jussieu.fr/mars/access) |
| Moon/Mars: USGS/IAU Gazetteer of Planetary Nomenclature | Official named-feature coordinates used by the location search. | [Gazetteer downloads](https://planetarynames.wr.usgs.gov/GIS_Downloads) |

The server calls NASA Trek map services for coordinate-specific Moon/Mars samples and the MCD point service at `https://www-mars.lmd.jussieu.fr/mcd_python/cgi-bin/mcdcgi.py`. If a source has no valid value for a point, ASTRA marks that parameter unavailable instead of inventing a measurement.

### Satellite imagery

| Location | Imagery source | What to expect |
| --- | --- | --- |
| Earth | [NASA GIBS WMS](https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi), using MODIS Terra true-color (and selectable Aqua imagery). | Daily satellite composites. The dashboard can search recent dates when the newest date has no usable coverage; the displayed capture date is shown. Clouds, resolution, and local coverage vary. |
| Moon | [NASA/JPL Trek](https://trek.nasa.gov/moon/), LRO WAC global mosaic tiles. | Orbital mosaic imagery; not a same-day photograph. Detail and coverage depend on the selected location and map zoom. |
| Mars | [NASA/JPL Trek](https://trek.nasa.gov/mars/), Viking global color mosaic and available higher-resolution products in their coverage areas. | Orbital mosaic imagery; resolution and availability differ across Mars. A global mosaic may be shown when no higher-resolution image covers the selected point. |

NASA imagery and map products do not require an ASTRA API key. If the image provider has no coverage, the app should report that instead of presenting an unrelated location as the selected site's image.

## API keys and tokens

Copy `.env.example` to `.env` in the project folder and fill only values you actually have. Keep `.env` private and do not paste credential values into this README or commit them.

| Setting | Required? | How ASTRA uses it |
| --- | --- | --- |
| `NASA_EARTHDATA_TOKEN` | Optional | Checked by `/api/auth/status` using a minimal NASA Common Metadata Repository (CMR) GraphQL request. This validates the token; it is not currently used to fetch POWER measurements or the imagery listed above. |
| `OPEN_TOPO_DATA_API_KEY` | Optional | Sent to OpenTopoData as `Authorization: Bearer ...`; can raise service limits. |
| `NASA_POWER_API_KEY` | Not applicable | NASA POWER is public/keyless. This setting is not read by ASTRA. |
| `OPEN_METEO_API_KEY` | Not currently used | Reserved in the example configuration; the current project uses no Open-Meteo API request. |
| `ASTRA_CONTACT_EMAIL` | Recommended for automated runs | Contact value in requests to OpenStreetMap/Overpass; it is not a credential. |
| `OVERPASS_URL` | Optional | Lets you select another Overpass API endpoint. |

Earthdata token validation is implemented in `ASTRA UI prototype/tools/serve.mjs` at `/api/auth/status`. The token remains on the server and is not sent to the browser. Do not put a token in client-side JavaScript.

## How ASTRA calculates a match

ASTRA compares only measurements with compatible meanings and units. Selected factor weights determine each factor's contribution. Missing measurements are excluded, not treated as zero; the score is shown with data coverage and uncertainty so a high score with limited evidence is visible as such. Planetary gravity, vacuum, radiation, and other cross-body differences cannot be recreated at an Earth site and are called out as limitations.

The Earth candidate list is a screening grid derived from retrieved datasets, not a complete survey of every coordinate on Earth. Resolution, observation period, uncertainty, and coverage differ by source. See [`docs/algorithm.md`](ASTRA%20UI%20prototype/docs/algorithm.md) and [`docs/data_dictionary.md`](ASTRA%20UI%20prototype/docs/data_dictionary.md) for the scoring and field definitions.

## Tests

From the `ASTRA UI prototype` folder, run:

```sh
node --test tests/algorithm.test.mjs
```

## Useful code locations

- `ASTRA UI prototype/js/main.js` - dashboard interactions and fresh-search handling
- `ASTRA UI prototype/js/core/imagery.js` - Earth, Moon, and Mars image requests
- `ASTRA UI prototype/js/core/scoring.js` and `ASTRA UI prototype/js/core/research.js` - comparison and research calculations
- `ASTRA UI prototype/js/data/targets.js` - planetary target data
- `ASTRA UI prototype/js/data/discovered.js` - generated Earth candidate snapshot
- `ASTRA UI prototype/tools/serve.mjs` - local server, planetary location search, live probe routes, Earthdata token validation
- `ASTRA UI prototype/tools/lib/planetary-probe.mjs` - live Moon/Mars coordinate measurements
- `ASTRA UI prototype/tools/lib/sources/` - Earth data source clients
- `ASTRA UI prototype/tools/discover.mjs` - Earth candidate grid discovery and snapshot generation
- `ASTRA UI prototype/.env.example` - documented environment settings (contains no real credentials)
- `ASTRA UI prototype/tests/algorithm.test.mjs` - automated tests
