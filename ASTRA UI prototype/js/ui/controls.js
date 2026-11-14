import { $ } from '../utils/dom.js';
import { FACTORS, PRESETS, TARGETS } from '../data/index.js';
import { state, curTarget } from '../core/state.js';

/**
 * Left column: target cards, weight presets and sliders.
 * Pure render functions — user intent is handled in js/main.js.
 */

export function renderTargets() {
  const list = $('#targetList');
  list.innerHTML = TARGETS
    .filter((t) => t.body === state.mode)
    .map((t) => (
      `<button type="button" class="tg" data-id="${t.id}" aria-pressed="${t.id === state.targetId}">` +
        `<b>${t.name}</b><span>${t.region}</span>` +
        `<div class="tags">${t.tags.map((x) => `<span class="tag">${x}</span>`).join('')}</div>` +
      '</button>'
    ))
    .join('');
}

export function renderPresets() {
  $('#presets').innerHTML = PRESETS
    .map((p) => `<button type="button" data-id="${p.id}" aria-pressed="false">${p.label}</button>`)
    .join('');
  markPreset();
}

/** Highlight the preset whose weights exactly match the live weights. */
export function markPreset() {
  document.querySelectorAll('#presets button').forEach((b) => {
    const p = PRESETS.find((x) => x.id === b.dataset.id);
    b.setAttribute('aria-pressed', String(FACTORS.every((f) => p.w[f.k] === state.weights[f.k])));
  });
}

export function renderSliders() {
  $('#sliders').innerHTML = FACTORS
    .map((f) => (
      `<div class="sl" id="sl-${f.k}">` +
        `<label for="w-${f.k}"><span>${f.label}</span><output id="o-${f.k}">${state.weights[f.k]}</output></label>` +
        `<input type="range" id="w-${f.k}" min="0" max="100" step="5" value="${state.weights[f.k]}">` +
        `<small>${f.hint}</small>` +
      '</div>'
    ))
    .join('');
  updateSliderState();
}

/** Dim the lava-tube weight when the selected target has no tube. */
export function updateSliderState() {
  const target = curTarget();
  const tube = target?.v?.tube;
  const off = (typeof tube === 'number' ? tube : tube?.value) < 50;
  const row = $('#sl-tube');
  row.classList.toggle('off', off);
  row.querySelector('small').textContent = !target
    ? 'Choose a Moon or Mars target first'
    : off
      ? 'Not used: this target has no lava tube'
      : 'Lava tube or cave entrances';
}
