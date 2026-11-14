import { $ } from './utils/dom.js';
import { ANALOGS, FACTORS, PRESETS, TARGETS, targetOf } from './data/index.js';
import { state, curTarget } from './core/state.js';
import { rankAnalogs } from './core/scoring.js';
import { rankMeasuredMarsPoint, validateMarsPointResponse } from './core/research.js';
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
    : target.custom
      ? rankMeasuredMarsPoint(target, ANALOGS, state.weights)
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
  locationRequestId += 1;
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
}

let locationRequestId = 0;

function selectLocation(body, lat, lon) {
  const requestId = ++locationRequestId;
  state.researchError = null;
  const point = {
    id: `picked-${body}-${lat.toFixed(3)}-${lon.toFixed(3)}`,
    body,
    name: `${body === 'earth' ? 'Earth' : state.mode === 'mars' ? 'Mars' : 'Moon'} ${Math.abs(lat).toFixed(3)}°${lat < 0 ? 'S' : 'N'}, ${Math.abs(lon).toFixed(3)}°${lon < 0 ? 'W' : 'E'}`,
    region: 'User-selected coordinates',
    lat,
    lon,
    custom: true,
    v: {},
    measurements: null,
    measurementStatus: body === 'earth' ? 'not_loaded' : 'loading'
  };
  state.ranked = [];
  state.analogId = null;
  if (body === 'earth') {
    state.customEarthPoint = point;
    state.customTarget = null;
    state.targetId = null;
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
  if (body === 'mars') {
    fetch(`/api/mars-point?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}`, { cache: 'no-store' })
      .then(async (response) => {
        const body = await response.text();
        let payload = null;
        try { payload = JSON.parse(body); } catch (_) { /* Report a useful dataset-level error below. */ }
        if (!response.ok) {
          throw new Error(payload?.error || `Mars Climate Database service route unavailable (HTTP ${response.status})`);
        }
        if (!payload) throw new Error('Mars Climate Database service returned an invalid response.');
        return payload;
      })
      .then((payload) => {
        if (requestId !== locationRequestId || state.customTarget?.id !== point.id) return;
        if (!validateMarsPointResponse(payload).valid) throw new Error('Mars Climate Database response failed scientific data validation');
        point.v = { temp: payload.values.temp, solar: payload.values.solar };
        point.measurements = payload;
        point.measurementStatus = 'validated';
        point.conf = 'Low';
        point.evidenceType = 'modelled_climatology';
        point.summary = 'MCD v6.2 model climatology, seasonally sampled and diurnally averaged at the selected coordinate.';
        state.researchError = null;
        refresh(true);
        if (state.view === 'compare') refreshCompare();
      })
      .catch((error) => {
        if (requestId !== locationRequestId || state.customTarget?.id !== point.id) return;
        point.measurementStatus = 'unavailable';
        state.researchError = `Mars Climate Database v6.2 unavailable: ${error.message}`;
        renderResults();
        updatePair();
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
  locationRequestId += 1;
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
