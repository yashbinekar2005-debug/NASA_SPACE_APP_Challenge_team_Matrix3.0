import { $ } from './utils/dom.js';
import { ANALOGS, FACTORS, PRESETS, TARGETS, targetOf } from './data/index.js';
import { state, curTarget } from './core/state.js';
import { rankAnalogs } from './core/scoring.js';
import { rankMeasuredEarthPoint, rankMeasuredPoint, validateEarthPointResponse, validatePointProbe } from './core/research.js';
import { D2R, shortest } from './utils/math.js';
import { clampT } from './graphics/globe.js';
import { renderTargets, renderPresets, renderSliders, markPreset, updateSliderState } from './ui/controls.js';
import { renderResults, updatePair } from './ui/results.js';
import {
  E, O, initStage, layoutStage, renderStage, flyEarth, flyOther, setOtherTexture
} from './ui/stage.js';
import { setView, initViews, refreshCompare } from './ui/views.js';
import { drawTerrains, resizeTerrains } from './ui/compare.js';

/**
 * Controller for Analog Finder.
 *
 * Everything that changes state lives here; the ui/ modules only render.
 * Flow: rank -> refresh -> (results, pair bar, globe camera).
 * The frame loop is shared by both screens.
 */

/* ------------------------- State changes ------------------------- */

function rank() {
  const target = curTarget();
  // Clear the previous query synchronously before ranking a newly selected
  // target. No result from the previous target can remain visible in state.
  state.ranked = !target
    ? []
    : state.customEarthPoint?.measurementStatus === 'validated'
      ? rankMeasuredEarthPoint(target, state.customEarthPoint, state.weights)
      : target.custom
      ? rankMeasuredPoint(target, ANALOGS, state.weights)
      : rankAnalogs(target, ANALOGS, state.weights).filter((result) => result.matchedFeatures.length > 0);
}

/**
 * Re-rank after a target or weight change, keep a sensible selection
 * (the previous one if it is still a top-six match), then repaint.
 */
function refresh(selectTop) {
  rank();
  const top = state.ranked.slice(0, 6).map((r) => r.analog.id);
  const prev = state.analogId;
  if (!state.ranked.length) {
    state.analogId = null;
  } else if (selectTop || !state.analogId || top.indexOf(state.analogId) < 0) {
    state.analogId = state.ranked[0].analog.id;
  }
  renderResults();
  updatePair();
  if (state.analogId !== prev) flyEarth();
}

function selectTarget(id) {
  planetRequestId += 1;
  earthRequestId += 1;
  state.researchError = null;
  const t = targetOf(id);
  if (!t) return;

  const modeChanged = t.body !== state.mode;
  // Drop old-query results before switching targets, then compute the new
  // score set from this target and the current weights.
  state.ranked = [];
  state.analogId = null;
  state.customTarget = null;
  state.customEarthPoint = null;
  state.targetId = id;
  state.mode = t.body;
  $('#app').className = 'wrap mode-' + state.mode;

  document.querySelectorAll('#modeSeg button').forEach((b) => {
    b.setAttribute('aria-pressed', String(b.dataset.mode === state.mode));
  });

  if (modeChanged) setOtherTexture();
  renderResults();
  renderTargets();
  updateSliderState();
  refresh(true);
  flyOther();
  if (state.view === 'compare') refreshCompare();
}

function selectAnalog(id) {
  if (!state.ranked.some((entry) => entry.analog.id === id)) return;
  state.analogId = id;
  renderResults();
  updatePair();
  flyEarth();
  renderLocationImagery();
}

function earthImageUrl(lat, lon, layer = 'MODIS_Terra_CorrectedReflectance_TrueColor') {
  const time = new Date(Date.now() - 3 * 86400000).toISOString().slice(0, 10);
  const halfLat = 0.45;
  const halfLon = Math.min(3, 0.45 / Math.max(0.15, Math.cos(lat * D2R)));
  const params = new URLSearchParams({
    SERVICE: 'WMS', REQUEST: 'GetMap', VERSION: '1.1.1', LAYERS: layer,
    STYLES: '', FORMAT: 'image/jpeg', SRS: 'EPSG:4326', WIDTH: '640', HEIGHT: '320',
    TIME: time,
    BBOX: `${Math.max(-180, lon - halfLon)},${Math.max(-90, lat - halfLat)},${Math.min(180, lon + halfLon)},${Math.min(90, lat + halfLat)}`
  });
  return `https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi?${params}`;
}

function pointImage(body, lat, lon) {
  if (body === 'earth') {
    return {
      url: earthImageUrl(lat, lon), fallback: earthImageUrl(lat, lon, 'MODIS_Aqua_CorrectedReflectance_TrueColor'),
      source: 'NASA GIBS · MODIS Terra true color',
      citation: 'Daily satellite composite; image footprint is centered on the selected coordinate.'
    };
  }
  const moon = body === 'moon';
  const product = moon ? 'LRO_WAC_Mosaic_Global_303ppd_v02' : 'Mars_Viking_MDIM21_ClrMosaic_global_232m';
  // NASA Trek geographic WMTS has 2×1 tiles at zoom 0, doubling each zoom.
  const z = 4;
  const cols = 2 * 2 ** z, rows = 2 ** z;
  const col = Math.max(0, Math.min(cols - 1, Math.floor((lon + 180) / 360 * cols)));
  const row = Math.max(0, Math.min(rows - 1, Math.floor((90 - lat) / 180 * rows)));
  return {
    url: `https://trek.nasa.gov/tiles/${moon ? 'Moon' : 'Mars'}/EQ/${product}/1.0.0/default/default028mm/${z}/${row}/${col}.jpg`,
    source: moon ? 'NASA/JPL/ASU LRO WAC global mosaic' : 'NASA/JPL Mars Trek Viking global color mosaic',
    citation: `Regional surface mosaic tile at ${lat.toFixed(3)}°, ${lon.toFixed(3)}°; not a point-specific raw frame.`
  };
}

function renderLocationImagery() {
  const root = $('#imagery');
  if (!root) return;
  const target = curTarget();
  const earth = state.customEarthPoint || state.ranked.find((entry) => entry.analog.id === state.analogId)?.analog || state.ranked[0]?.analog;
  const planet = state.customTarget || state.customEarthPoint?.counterpart || target;
  const points = [];
  if (planet?.custom && planet.measurementStatus !== 'unavailable') points.push({ label: 'Selected planetary coordinate', ...planet });
  else if (planet && Number.isFinite(planet.lat) && Number.isFinite(planet.lon)) points.push({ label: `Selected ${planet.body} reference`, ...planet });
  if (earth && Number.isFinite(earth.lat) && Number.isFinite(earth.lon)) points.push({ label: state.customEarthPoint ? 'Selected Earth coordinate' : 'Closest ranked Earth region', ...earth, body: 'earth' });
  if (!points.length) { root.hidden = true; root.replaceChildren(); return; }
  root.hidden = false;
  root.replaceChildren();
  for (const point of points.slice(0, 2)) {
    const image = pointImage(point.body, point.lat, point.lon);
    const figure = document.createElement('figure');
    figure.className = 'image-card';
    const img = document.createElement('img');
    img.loading = 'lazy'; img.referrerPolicy = 'no-referrer';
    img.alt = `${image.source} imagery near ${point.lat.toFixed(3)}, ${point.lon.toFixed(3)}`;
    const caption = document.createElement('figcaption');
    const title = document.createElement('b'); title.textContent = `${point.label}: ${point.name || `${point.lat.toFixed(3)}°, ${point.lon.toFixed(3)}°`}`;
    const provenance = document.createElement('span'); provenance.textContent = `${image.source}. ${image.citation} `;
    const link = document.createElement('a'); link.href = image.url; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.textContent = 'Source';
    caption.append(title, provenance, link); figure.append(img, caption); root.append(figure);
    img.onerror = () => {
      if (image.fallback && img.dataset.fallback !== 'used') { img.dataset.fallback = 'used'; img.src = image.fallback; }
      else { img.removeAttribute('src'); img.alt = `Imagery unavailable from ${image.source}`; figure.classList.add('image-unavailable'); provenance.textContent = `${image.source} is currently unavailable for this location.`; }
    };
    img.src = image.url;
  }
}

let planetRequestId = 0;
let earthRequestId = 0;

function selectLocation(body, lat, lon) {
  const requestId = body === 'earth' ? ++earthRequestId : ++planetRequestId;
  if (body !== 'earth') earthRequestId += 1;
  state.researchError = null;
  const selectedPlanetBeforeEarthClick = body === 'earth' ? curTarget() : null;
  const point = {
    id: `picked-${body}-${lat.toFixed(3)}-${lon.toFixed(3)}`,
    body,
    name: `${body === 'earth' ? 'Earth' : state.mode === 'mars' ? 'Mars' : 'Moon'} ${Math.abs(lat).toFixed(3)}°${lat < 0 ? 'S' : 'N'}, ${Math.abs(lon).toFixed(3)}°${lon < 0 ? 'W' : 'E'}`,
    region: 'User-selected coordinates',
    lat,
    lon,
    custom: true,
    v: {},
    conf: 'Unknown',
    goal: body === 'earth'
      ? 'Inspect the selected Earth coordinate and compare only the measured NASA POWER parameters with the chosen planetary target.'
      : 'Probe the selected planetary coordinate and compare only the measured factors with the discovered Earth cells.',
    measurements: null,
    counterpart: selectedPlanetBeforeEarthClick,
    measurementStatus: 'loading'
  };
  state.ranked = [];
  state.analogId = null;
  if (body === 'earth') {
    state.customEarthPoint = point;
    state.customTarget = selectedPlanetBeforeEarthClick?.custom ? selectedPlanetBeforeEarthClick : null;
  }
  else {
    state.customTarget = point;
    state.customEarthPoint = null;
    state.targetId = null;
    state.mode = body;
    $('#app').className = 'wrap mode-' + state.mode;
    document.querySelectorAll('#modeSeg button').forEach((b) => {
      b.setAttribute('aria-pressed', String(b.dataset.mode === state.mode));
    });
  }
  renderResults();
  updatePair();
  if (body === 'earth') {
    E.yawT = E.yaw + shortest(lon * D2R - E.yaw);
    E.tiltT = clampT(lat * D2R * .8);
  } else {
    O.yawT = O.yaw + shortest(lon * D2R - O.yaw);
    O.tiltT = clampT(lat * D2R * .8);
  }
  if (state.view === 'compare') refreshCompare();
  renderLocationImagery();
  if (body === 'moon' || body === 'mars' || body === 'earth') {
    const endpoint = body === 'earth'
      ? `/api/earth-point?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}`
      : `/api/probe?body=${body}&lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}`;
    const datasetName = body === 'earth'
      ? 'NASA POWER / MERRA-2'
      : body === 'mars' ? 'NASA Mars Trek + MCD v6.2' : 'NASA Moon Trek';
    const isCurrent = () => requestId === (body === 'earth' ? earthRequestId : planetRequestId) &&
      (body === 'earth' ? state.customEarthPoint?.id === point.id : state.customTarget?.id === point.id);
    fetch(endpoint, { cache: 'no-store' })
      .then(async (response) => {
        const text = await response.text();
        let payload = null;
        try { payload = JSON.parse(text); } catch (_) { /* Report a useful dataset-level error below. */ }
        if (!response.ok) {
          throw new Error(payload?.error || `${payload?.dataset || datasetName} service route unavailable (HTTP ${response.status})`);
        }
        if (!payload) throw new Error(`${datasetName} service returned an invalid response.`);
        return payload;
      })
      .then((payload) => {
        if (!isCurrent()) return;
        if (body === 'earth') {
          const validation = validateEarthPointResponse(payload, lat, lon);
          if (!validation.valid) {
            throw new Error(`NASA POWER response failed scientific data validation${validation.errors?.length ? `: ${validation.errors[0]}` : ''}`);
          }
          point.v = payload.features;
          point.conf = 'Medium';
          point.evidenceType = 'reanalysis_climatology';
          point.summary = 'NASA POWER/MERRA-2 coordinate climatology; only overlapping measured features are compared.';
        } else {
          const validation = validatePointProbe(payload, body);
          if (!validation.valid) {
            throw new Error(`${datasetName} response failed scientific data validation${validation.errors?.length ? `: ${validation.errors[0]}` : ''}`);
          }
          point.v = Object.fromEntries(Object.entries(payload.values)
            .filter(([, value]) => value && Number.isFinite(value.value)));
          point.conf = body === 'mars' ? 'Low' : 'Medium';
          point.evidenceType = body === 'mars' ? 'modelled_climatology' : 'remote_sensing';
          point.summary = body === 'mars'
            ? 'NASA Mars Trek MOLA/USGS geology plus MCD v6.2 model climatology at the selected coordinate; MCD values are modelled, not direct station observations.'
            : 'NASA Moon Trek LRO LOLA/Diviner and Kaguya MI point measurements at the selected coordinate; unavailable products are excluded rather than estimated.';
        }
        point.measurements = payload;
        point.measurementStatus = 'validated';
        state.researchError = null;
        refresh(true);
        renderLocationImagery();
        if (state.view === 'compare') refreshCompare();
      })
      .catch((error) => {
        if (!isCurrent()) return;
        point.measurementStatus = 'unavailable';
        state.researchError = `${datasetName} unavailable: ${error.message}`;
        renderResults();
        updatePair();
        renderLocationImagery();
        if (state.view === 'compare') refreshCompare();
      });
  }
}

function setWeight(key, value) {
  state.weights[key] = value;
  $('#o-' + key).textContent = value;
  markPreset();
  refresh(false);
}

function applyPreset(preset) {
  state.weights = Object.assign({}, preset.w);
  FACTORS.forEach((f) => {
    $('#w-' + f.k).value = state.weights[f.k];
    $('#o-' + f.k).textContent = state.weights[f.k];
  });
  markPreset();
  refresh(false);
}

/* --------------------------- Events ------------------------------ */

$('#targetList').addEventListener('click', (e) => {
  const b = e.target.closest('.tg');
  if (b) selectTarget(b.dataset.id);
});

$('#modeSeg').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b || b.dataset.mode === state.mode) return;
  planetRequestId += 1;
  earthRequestId += 1;
  state.researchError = null;
  state.mode = b.dataset.mode;
  state.targetId = null;
  state.customTarget = null;
  state.customEarthPoint = null;
  state.analogId = null;
  state.ranked = [];
  $('#app').className = 'wrap mode-' + state.mode;
  document.querySelectorAll('#modeSeg button').forEach((button) => {
    button.setAttribute('aria-pressed', String(button.dataset.mode === state.mode));
  });
  setOtherTexture();
  renderTargets();
  refresh(false);
  flyOther();
  if (state.view === 'compare') refreshCompare();
});

$('#presets').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  const p = PRESETS.find((x) => x.id === b.dataset.id);
  if (p) applyPreset(p);
});

$('#sliders').addEventListener('input', (e) => {
  const id = e.target.id;
  if (!id || id.indexOf('w-') !== 0) return;
  setWeight(id.slice(2), +e.target.value);
});

$('#resultList').addEventListener('click', (e) => {
  const b = e.target.closest('.res');
  if (b) selectAnalog(b.dataset.id);
});

window.addEventListener('resize', () => {
  if (state.view === 'explore') layoutStage();
  else resizeTerrains();
});

/* ---------------------------- Loop ------------------------------- */

let last = 0;

function frame(now) {
  requestAnimationFrame(frame);
  if (document.hidden || now - last < 28) return;
  last = now;
  if (state.view === 'explore') renderStage(now);
  else drawTerrains(now);
}

/* ---------------------------- Boot ------------------------------- */

fetch('/api/auth/status', { cache: 'no-store' })
  .then((response) => {
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  })
  .then(({ earthdata }) => {
    const badge = $('#authStatus');
    if (!badge) return;
    const labels = {
      valid: 'NASA Earthdata token validated',
      invalid: 'NASA Earthdata token rejected',
      missing: 'NASA Earthdata token not configured',
      unavailable: 'NASA Earthdata validation unavailable'
    };
    badge.textContent = labels[earthdata?.status] || 'NASA Earthdata validation unavailable';
    badge.dataset.auth = earthdata?.status || 'unavailable';
  })
  .catch(() => {
    const badge = $('#authStatus');
    if (badge) badge.textContent = 'NASA Earthdata status unavailable · start tools/serve.mjs';
  });

initViews();
initStage({ onSelectAnalog: selectAnalog, onSelectTarget: selectTarget, onSelectLocation: selectLocation });

renderTargets();
renderPresets();
renderSliders();
refresh(true);

layoutStage();
E.yaw = E.yawT; O.yaw = O.yawT; E.tilt = E.tiltT; O.tilt = O.tiltT;
flyEarth(); flyOther();
E.yaw = E.yawT; O.yaw = O.yawT; E.tilt = E.tiltT; O.tilt = O.tiltT;

if (location.hash === '#compare') setView('compare');
requestAnimationFrame(frame);
