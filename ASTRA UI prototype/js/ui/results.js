import { $ } from '../utils/dom.js';
import { state, curTarget } from '../core/state.js';

/**
 * Right column: ranked match list and the selected-pair bar.
 * Selection itself is handled in js/main.js.
 */

/** Mini factor bars under each score: one bar per factor, left to right. */
function fpHtml(parts) {
  return '<span class="fp" aria-hidden="true">' + parts.map((p) => (
    p.na
      ? '<u class="na"></u>'
      : `<u style="height:${Math.max(2, Math.round(p.sim * .18))}px;opacity:${(.35 + p.sim / 160).toFixed(2)}"></u>`
  )).join('') + '</span>';
}

export function renderResults() {
  $('#resTitle').textContent = 'Best matches for ' + curTarget().name;
  $('#resultList').innerHTML = state.ranked.slice(0, 6).map((r, i) => {
    const coverage = Math.round((r.coverage ?? 0) * 100);
    const confidence = Math.round(r.confidence ?? 0);
    const provisional = r.status && r.status !== 'ok' ? ' · provisional' : '';
    return (
      `<li><button type="button" class="res" data-id="${r.analog.id}" aria-current="${r.analog.id === state.analogId}" ` +
        `title="Data coverage ${coverage}% · confidence ${confidence}%${provisional}">` +
        `<span class="rk">${i + 1}</span>` +
        `<span class="nm"><b>${r.analog.name}</b><i>${r.analog.region}</i></span>` +
        `<span><span class="sc">${Math.round(r.total)}%</span>${fpHtml(r.parts)}</span>` +
        `<span class="bar"><i style="width:${Math.round(r.total)}%"></i></span>` +
      '</button></li>'
    );
  }).join('');
}

export function updatePair() {
  const t = curTarget();
  const r = state.ranked.find((x) => x.analog.id === state.analogId);
  if (!r) return;
  $('#pairNames').innerHTML =
    `<span class="sp">${t.name}</span><span class="ar">⇄</span><span class="ea">${r.analog.name}</span>`;
  $('#pairScore').textContent = Math.round(r.total) + '%';
  $('#pairRing').style.setProperty('--p', Math.round(r.total));
  $('#pairRing').title = 'Data coverage ' + Math.round((r.coverage ?? 0) * 100) +
    '% · confidence ' + Math.round(r.confidence ?? 0) + '%';
}
