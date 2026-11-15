import { $ } from './utils/dom.js';
import { ANALOGS, FACTORS, PRESETS, TARGETS, targetOf } from './data/index.js';
import { state, curTarget } from './core/state.js';
import { rankAnalogs } from './core/scoring.js';
import { rankMeasuredEarthPoint, rankMeasuredPoint, validateEarthPointResponse, validatePointProbe } from './core/research.js';
import { hasVisibleImageCoverage, pointImage } from './core/imagery.js';
import { D2R, shortest } from './utils/math.js';
import { clampT } from './graphics/globe.js';
import { renderTargets, renderPresets, renderSliders, markPreset, updateSliderState, renderPlanetLocations, updatePlanetLocationStatus } from './ui/controls.js';
import { renderResults, updatePair, visibleRanked } from './ui/results.js';
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
  const visible = visibleRanked();
  const prev = state.analogId;
  // Every fresh research execution selects its highest-scoring supportable
  // candidate. Manual selection remains possible until weights/query change.
  state.analogId = visible[0]?.analog.id ?? null;
  renderResults();
  updatePair();
  if (state.analogId !== prev) { flyEarth(); renderLocationImagery(); }
  if (state.view === 'compare') refreshCompare();
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
  renderLocationImagery();
}

function selectAnalog(id) {
  if (!visibleRanked().some((entry) => entry.analog.id === id)) return;
  state.earthImageAssessment = null;
  state.analogId = id;
  renderResults();
  updatePair();
  flyEarth();
  renderLocationImagery();
  if (state.view === 'compare') refreshCompare();
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
    const image = pointImage(point.body, point.lat, point.lon, point.body === 'earth' ? state.earthImageDate : null, state.earthImageSatellite || 'Terra');
    const figure = document.createElement('figure');
    figure.className = 'image-card';
    const img = document.createElement('img');
    img.loading = 'lazy'; img.referrerPolicy = 'no-referrer';
    if (point.body === 'earth') img.crossOrigin = 'anonymous';
    img.alt = `${image.source} imagery near ${point.lat.toFixed(3)}, ${point.lon.toFixed(3)}`;
    const caption = document.createElement('figcaption');
    const title = document.createElement('b'); title.textContent = `${point.label}: ${point.name || `${point.lat.toFixed(3)}°, ${point.lon.toFixed(3)}°`}`;
    const provenance = document.createElement('span'); provenance.textContent = `${image.source}. ${image.citation} `;
    const link = document.createElement('a'); link.textContent = image.url ? 'Source' : 'Choose a capture date in Compare';
    if (image.url) { link.href = image.url; link.target = '_blank'; link.rel = 'noopener noreferrer'; }
    caption.append(title, provenance, link); figure.append(caption); if (image.url) figure.prepend(img); else figure.classList.add('image-date-empty'); root.append(figure);
    const fallbacks = image.fallbacks?.length ? image.fallbacks : (image.fallback ? [image.fallback] : []);
    const tryNextFallback = () => {
      const fallbackIndex = Number(img.dataset.fallbackIndex || 0);
      if (fallbackIndex < fallbacks.length) {
        img.dataset.fallbackIndex = String(fallbackIndex + 1);
        img.src = fallbacks[fallbackIndex];
        return true;
      }
      return false;
    };
    const showUnavailable = () => {
      img.remove(); figure.classList.add('image-unavailable'); provenance.textContent = `${image.source} has no image coverage at this coordinate in the available capture dates.`;
    };
    img.onerror = () => { if (!tryNextFallback()) showUnavailable(); };
    img.onload = () => {
      if (point.body !== 'earth' || !image.latest) return;
      if (!hasVisibleImageCoverage(img)) {
        if (!tryNextFallback()) showUnavailable();
        return;
      }
      const fallbackIndex = Number(img.dataset.fallbackIndex || 0);
      if (fallbackIndex > 0) {
        const captureDate = image.fallbackDates?.[fallbackIndex - 1];
        if (captureDate) {
          provenance.textContent = `${image.source}. Latest capture with image coverage at this coordinate: ${captureDate}.`;
          link.href = img.src;
        }
      }
    };
    if (image.url) img.src = image.url;
  }
}

let planetRequestId = 0;
let earthRequestId = 0;

function selectLocation(body, lat, lon, namedFeature = null) {
  const requestId = body === 'earth' ? ++earthRequestId : ++planetRequestId;
  if (body !== 'earth') earthRequestId += 1;
  state.researchError = null;
  const selectedPlanetBeforeEarthClick = body === 'earth' ? curTarget() : null;
  const point = {
    id: `picked-${body}-${lat.toFixed(3)}-${lon.toFixed(3)}`,
    body,
    name: namedFeature?.name || `${body === 'earth' ? 'Earth' : state.mode === 'mars' ? 'Mars' : 'Moon'} ${Math.abs(lat).toFixed(3)}°${lat < 0 ? 'S' : 'N'}, ${Math.abs(lon).toFixed(3)}°${lon < 0 ? 'W' : 'E'}`,
    region: namedFeature?.kind ? `${namedFeature.kind} · ${namedFeature.sourceType || 'USGS/IAU named feature'}` : 'User-selected coordinates',
    kind: namedFeature?.kind || null,
    locationSource: namedFeature ? (namedFeature.source || { name: 'USGS/IAU Gazetteer of Planetary Nomenclature', url: 'https://planetarynames.wr.usgs.gov/GIS_Downloads' }) : null,
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
    state.earthImageAssessment = null;
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
  if (namedFeature && body !== 'earth') {
    document.querySelectorAll('#planetLocationResults .planet-place').forEach((button) => {
      const selected = Number(button.dataset.lat) === lat && Number(button.dataset.lon) === lon;
      button.setAttribute('aria-pressed', String(selected));
      button.classList.toggle('selected', selected);
    });
    const label = namedFeature.kind ? `${namedFeature.name} ${namedFeature.kind}` : namedFeature.name;
    updatePlanetLocationStatus(`${label} selected at ${lat.toFixed(5)}°, ${lon.toFixed(5)}°. Retrieving coordinate-specific ${body} measurements…`);
  }
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
          if (payload.location?.name) point.name = payload.location.name;
          if (payload.location?.country) point.region = [payload.location.subdivision, payload.location.country].filter(Boolean).join(', ');
          if (payload.location?.source) point.locationSource = { ...payload.location.source, reference: payload.location.reference };
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
        if (namedFeature) updatePlanetLocationStatus(`${namedFeature.name}${namedFeature.kind ? ` ${namedFeature.kind}` : ''} · ${lat.toFixed(5)}°, ${lon.toFixed(5)}° · measurements validated from ${datasetName}.`);
        refresh(true);
        renderLocationImagery();
      })
      .catch((error) => {
        if (!isCurrent()) return;
        point.measurementStatus = 'unavailable';
        state.researchError = `${datasetName} unavailable: ${error.message}`;
        if (namedFeature) updatePlanetLocationStatus(`${namedFeature.name}: ${datasetName} unavailable — ${error.message}`);
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

let locationSearchTimer = null;
let locationSearchId = 0;
let locationSearchController = null;
async function fetchPlanetaryLocationPage(query, body, offset, append, searchId) {
  const controller = new AbortController();
  locationSearchController = controller;
  try {
    const url = `/api/planetary-locations?body=${encodeURIComponent(body)}&q=${encodeURIComponent(query)}&offset=${offset}&limit=40`;
    const response = await fetch(url, { cache: 'no-store', signal: controller.signal });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload?.error || `Gazetteer request failed (HTTP ${response.status})`);
    if (searchId !== locationSearchId || body !== state.mode || query !== $('#planetLocationSearch').value.trim()) return;
    renderPlanetLocations(payload, { append });
  } catch (error) {
    if (error.name === 'AbortError' || searchId !== locationSearchId) return;
    const message = `USGS/IAU Gazetteer unavailable: ${error.message}`;
    if (append) {
      const more = $('#planetLocationResults [data-load-more]');
      if (more) { more.disabled = false; more.textContent = 'Retry loading more locations'; }
      updatePlanetLocationStatus(message);
    }
    else renderPlanetLocations({ query, error: message, results: [] });
  }
}

$('#planetLocationSearch').addEventListener('input', (event) => {
  const query = event.target.value.trim();
  const searchId = ++locationSearchId;
  if (locationSearchTimer) clearTimeout(locationSearchTimer);
  if (locationSearchController) locationSearchController.abort();
  renderPlanetLocations({ query, results: [] });
  if (query.length < 2) return;
  locationSearchTimer = setTimeout(async () => {
    const body = state.mode;
    fetchPlanetaryLocationPage(query, body, 0, false, searchId);
  }, 250);
});

$('#planetLocationResults').addEventListener('click', (event) => {
  const more = event.target.closest('[data-load-more]');
  if (more) {
    const query = $('#planetLocationSearch').value.trim();
    if (query.length < 2) return;
    more.disabled = true;
    more.textContent = 'Loading more locations…';
    const offset = $('#planetLocationResults').querySelectorAll('.planet-place').length;
    if (locationSearchController) locationSearchController.abort();
    const searchId = ++locationSearchId;
    fetchPlanetaryLocationPage(query, state.mode, offset, true, searchId);
    return;
  }
  const button = event.target.closest('.planet-place');
  if (!button) return;
  const lat = Number(button.dataset.lat), lon = Number(button.dataset.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
  selectLocation(state.mode, lat, lon, { name: button.dataset.name, kind: button.dataset.kind });
});

$('#earthRegion').addEventListener('change', (event) => {
  state.earthRegion = event.target.value;
  const visible = visibleRanked();
  state.analogId = visible[0]?.analog.id || null;
  renderResults(); updatePair();
  if (state.analogId) flyEarth();
  renderLocationImagery();
  if (state.view === 'compare') refreshCompare();
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
  $('#planetLocationSearch').value = '';
  locationSearchId += 1;
  if (locationSearchController) locationSearchController.abort();
  renderPlanetLocations({ query: '', results: [] });
  document.querySelectorAll('#modeSeg button').forEach((button) => {
    button.setAttribute('aria-pressed', String(button.dataset.mode === state.mode));
  });
  setOtherTexture();
  renderTargets();
  refresh(false);
  flyOther();
  renderLocationImagery();
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

$('#rerunAnalysis').addEventListener('click', () => {
  const point = state.customEarthPoint || (state.customTarget?.custom ? state.customTarget : null);
  if (point) {
    selectLocation(point.body, point.lat, point.lon, point.name ? {
      name: point.name, kind: point.kind, source: point.locationSource,
      sourceType: point.body === 'earth' ? 'reverse geocoder' : 'USGS/IAU Gazetteer'
    } : null);
    return;
  }
  refresh(true);
});

$('#exportAnalysis').addEventListener('click', () => {
  const target = curTarget();
  const result = visibleRanked().find((entry) => entry.analog.id === state.analogId);
  if (!target || !result) return;
  const report = {
    generatedAt: new Date().toISOString(),
    target: { body: target.body, name: target.name, latitude: target.lat, longitude: target.lon, dataset: target.measurements?.dataset || target.dataset || null, measurements: target.measurements?.values || target.v || {}, locationSource: target.locationSource || null },
    earthCandidate: { name: result.analog.name, region: result.analog.region, latitude: result.analog.lat, longitude: result.analog.lon, measurements: result.analog.v || {}, provenance: result.analog.provenance || [] },
    analysis: { score: result.total, status: result.status, coverage: result.coverage, confidence: result.confidence, certainty: result.certaintyLabel, uncertainty: result.uncertainty, scoreInterval: result.scoreInterval, parameters: result.parts.map((part) => ({ parameter: part.f.label, target: part.t, earth: part.a, similarity: part.na ? null : part.sim, distance: part.d, weight: part.na ? 0 : part.wt, compared: Boolean(part.valid && !part.na) })) },
    caveats: result.warnings || []
  };
  const href = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = href; link.download = `astra-${target.body}-analogy-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(href), 1000);
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
      missing: 'NASA Earthdata token missing · public datasets still available',
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
