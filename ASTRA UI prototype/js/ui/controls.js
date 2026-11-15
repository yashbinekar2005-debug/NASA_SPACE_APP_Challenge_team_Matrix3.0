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

export function setPlanetLocationStatus(message) {
  const status = $('#planetLocationStatus');
  if (status) status.textContent = message;
}

export const updatePlanetLocationStatus = setPlanetLocationStatus;

export function renderPlanetLocations(payload, { append = false } = {}) {
  const root = $('#planetLocationResults');
  if (!root) return;
  root.querySelector('[data-load-more]')?.remove();
  if (!append) root.replaceChildren();
  const rows = Array.isArray(payload?.results) ? payload.results : [];
  if (!rows.length) {
    if (!append) setPlanetLocationStatus(payload?.error || (payload?.query?.length >= 2
      ? 'No named features matched that search in the live USGS/IAU gazetteer.'
      : 'Enter at least two characters to search IAU location names or feature types.'));
    return;
  }
  const shown = (Number(payload.offset) || 0) + rows.length;
  setPlanetLocationStatus(`${payload.total.toLocaleString()} gazetteer match${payload.total === 1 ? '' : 'es'}; showing ${shown} of ${payload.total}. Source: USGS/IAU Gazetteer.`);
  for (const feature of rows) {
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'planet-place';
    button.dataset.lat = String(feature.lat); button.dataset.lon = String(feature.lon);
    button.dataset.name = feature.name; button.dataset.kind = feature.kind || 'IAU-named feature';
    const name = document.createElement('b'); name.textContent = feature.name;
    const details = document.createElement('span'); details.textContent = `${feature.kind || 'IAU-named feature'} · ${Math.abs(feature.lat).toFixed(5)}°${feature.lat < 0 ? 'S' : 'N'}, ${Math.abs(feature.lon).toFixed(5)}°${feature.lon < 0 ? 'W' : 'E'}`;
    button.append(name, details); root.append(button);
  }
  if (payload.hasMore) {
    const more = document.createElement('button');
    more.type = 'button'; more.className = 'planet-place-more';
    more.dataset.loadMore = 'true';
    more.textContent = `Load more named locations (${payload.total - shown} remaining)`;
    root.append(more);
  }
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
