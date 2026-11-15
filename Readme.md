# ASTRA: Earth Analog Finder

ASTRA helps you explore how selected places on the Moon or Mars compare with places on Earth. Choose a published planetary target or click a coordinate on a globe, then review the measurements, image sources, and similarity results together.

## What you can do

- Select a Moon or Mars target, or probe a coordinate directly on the globe.
- Compare supported measurements such as temperature, sunlight, terrain, geology, soil, and water or ice evidence.
- Adjust factor weights and see the Earth ranking update.
- Review the score breakdown, data coverage, uncertainty, sources, and environmental differences that Earth cannot reproduce.
- View NASA imagery for both selected locations. Earth imagery uses NASA GIBS; if the latest image has no visible coverage, ASTRA checks recent dates and labels the capture it displays. Moon and Mars imagery uses NASA/JPL Trek mosaics.
- Open the detailed site report or export the comparison as a PDF.

## Start the app

You need Node.js 18 or newer. No package installation or build step is required.

From this folder, run:

```sh
node tools/serve.mjs
```

Then open [http://localhost:4173](http://localhost:4173). To use a different port, set the `PORT` environment variable before starting the server.

The server supports live coordinate probes and the app's data routes. A static host can display the front end and its committed Earth discovery snapshot, but it cannot provide those live server routes by itself.

## API keys and tokens

Most connected sources are public and do not need an API key. In particular, NASA POWER is keyless; setting `NASA_POWER_API_KEY` does not change its requests or improve its results. The app requests POWER's 2001-2020 climatology.

Two optional settings are documented in [.env.example](.env.example):

- `NASA_EARTHDATA_TOKEN` lets the server check whether an Earthdata Login token is valid at `/api/auth/status`. It is not needed for NASA POWER.
- `OPEN_TOPO_DATA_API_KEY` can be used for OpenTopoData requests when regenerating the Earth discovery data.

Keep credentials in the root `.env` file. Do not commit that file or paste credential values into the README.

## How the comparisons work

Earth candidates are screening-grid cells from the committed discovery snapshot in `js/data/discovered.js`. The snapshot is generated from NASA POWER climate data, SRTM elevation, SoilGrids soil data, and Macrostrat geology. To fetch and rebuild the snapshot, run:

```sh
node tools/discover.mjs
```

When you click a planetary coordinate, the server requests coordinate-specific products where available. Moon probes use sources such as LRO LOLA and Diviner and Kaguya MI. Mars probes use MOLA, USGS SIM3292 geology, and the Mars Climate Database. The app identifies modelled climatology and proxy values as such in the results.

A similarity score is calculated from the selected weights and valid, comparable measurements. Missing or incompatible measurements are excluded rather than treated as zero. The results show coverage and uncertainty alongside the score, and explain important differences such as lunar gravity, vacuum, and radiation that an Earth location cannot match.

The Earth candidate snapshot is a sampled search grid, not a measurement at every point on Earth. Satellite coverage, product resolution, observation dates, and model periods vary by dataset. A matching score is a research aid, not proof that two environments are identical.

## Run the tests

Run the project's Node test suite with:

```sh
node --test tests/algorithm.test.mjs
```

The tests cover scoring and ranking, measurement validation, imagery request construction, coordinate probes, and display formatting.

## Where to look in the code

- `index.html` and `css/`: page structure and styles
- `js/main.js`: app interactions and dashboard rendering
- `js/core/algorithm/`: similarity scoring, confidence, and uncertainty
- `js/core/imagery.js`: NASA image requests and date handling
- `js/data/targets.js` and `js/data/discovered.js`: planetary targets and Earth candidate snapshot
- `tools/serve.mjs`: local server and live API routes
- `tools/lib/planetary-probe.mjs`: Moon and Mars coordinate measurements
- `tools/discover.mjs`: Earth candidate snapshot generation
- `tests/algorithm.test.mjs`: automated tests
- `docs/algorithm.md` and `docs/data_dictionary.md`: scoring details and data definitions
