import { $ } from './utils/dom.js';
import { ANALOGS, FACTORS, PRESETS, TARGETS, targetOf } from './data/index.js';
import { state, curTarget } from './core/state.js';
import { rankAnalogs } from './core/scoring.js';
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
  state.ranked = rankAnalogs(curTarget(), ANALOGS, state.weights);
}

/**
 * Re-rank after a target or weight change, keep a sensible selection
 * (the previous one if it is still a top-six match), then repaint.
 */
function refresh(selectTop) {
  rank();
  const top = state.ranked.slice(0, 6).map((r) => r.analog.id);
  const prev = state.analogId;
  if (selectTop || !state.analogId || top.indexOf(state.analogId) < 0) {
    state.analogId = state.ranked[0].analog.id;
  }
  renderResults();
  updatePair();
  if (state.analogId !== prev) flyEarth();
}

function selectTarget(id) {
  const t = targetOf(id);
  if (!t) return;

  const modeChanged = t.body !== state.mode;
  state.targetId = id;
  state.mode = t.body;
  $('#app').className = 'wrap mode-' + state.mode;

  document.querySelectorAll('#modeSeg button').forEach((b) => {
    b.setAttribute('aria-pressed', String(b.dataset.mode === state.mode));
  });

  if (modeChanged) setOtherTexture();
  renderTargets();
  updateSliderState();
  refresh(true);
  flyOther();
  if (state.view === 'compare') refreshCompare();
}

function selectAnalog(id) {
  state.analogId = id;
  renderResults();
  updatePair();
  flyEarth();
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
  const first = TARGETS.find((t) => t.body === b.dataset.mode);
  selectTarget(first.id);
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

initViews();
initStage({ onSelectAnalog: selectAnalog, onSelectTarget: selectTarget });

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
