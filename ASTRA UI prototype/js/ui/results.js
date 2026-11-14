import { $ } from '../utils/dom.js';
import { state, curTarget } from '../core/state.js';
import { fmtCoords } from '../utils/format.js';
import { DISCOVERY } from '../data/index.js';

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

/** Score uncertainty (±1σ points) and the 95 % interval, in one short line. */
function certaintyHtml(r) {
  const sigma = r.uncertainty && r.uncertainty.sigma;
  if (sigma == null) return '<span class="cert">uncertainty n/a</span>';
  const interval = r.scoreInterval;
  const title = interval
    ? `95% interval ${interval[0]}–${interval[1]}% · ${r.certaintyLabel} certainty`
    : r.certaintyLabel + ' certainty';
  return `<span class="cert" title="${title}">±${Math.round(sigma)} pts</span>`;
}

export function renderResults() {
  const target = curTarget();
  const earthPoint = state.customEarthPoint;
  $('#resTitle').textContent = target?.custom
    ? (target.measurementStatus === 'validated' ? 'Closest measured Earth matches' : 'Custom planetary point selected')
    : earthPoint
      ? 'Custom Earth point selected'
      : target
        ? 'Best matches for ' + target.name
        : 'Choose a target to begin';
  const meta = $('#resMeta');
  if (meta) {
    const n = DISCOVERY.candidates.length;
    meta.textContent = target?.custom
      ? target.measurementStatus === 'loading'
        ? 'Retrieving coordinate-specific Mars climate data before comparing candidates…'
        : target.measurementStatus === 'validated'
          ? state.ranked.length
            ? `${target.measurements.source.name}; ${target.measurements.source.period}. Ranked against ${DISCOVERY.candidates.length} measured Earth cells from the current ${DISCOVERY.grid.stepDegrees}° discovery snapshot using current weights; this is not an exhaustive Earth grid. Planetary differences are reported separately.`
            : 'No scientifically supportable candidate regions were identified from the currently available datasets.'
          : state.researchError || 'No validated planetary measurements are available for this coordinate.'
      : earthPoint
        ? 'Select a Mars point to compare against Earth analogs. Earth measurements for this point have not been retrieved.'
      : target
        ? `${n} measured Earth cells from the discovery snapshot (${DISCOVERY.generatedAt || 'date unavailable'}); scores recalculated for this target and current weights.`
        : 'Select a measured target on the left or its pin, or click a coordinate on either globe.';
  }

  $('#resultList').innerHTML = target && (!target.custom || target.measurementStatus === 'validated') && !earthPoint ? state.ranked.slice(0, 6).map((r, i) => {
    const coverage = Math.round((r.coverage ?? 0) * 100);
    const confidence = Math.round(r.confidence ?? 0);
    const provisional = r.status && r.status !== 'ok' ? ' · provisional' : '';
    const coords = fmtCoords(r.analog.lat, r.analog.lon);
    const metaBits = [coords, `coverage ${coverage}%`, `confidence ${confidence}%`].filter(Boolean);
    return (
      `<li><button type="button" class="res" data-id="${r.analog.id}" aria-current="${r.analog.id === state.analogId}" ` +
        `title="${metaBits.join(' · ')}${provisional}">` +
        `<span class="rk">${i + 1}</span>` +
        `<span class="nm"><b>${r.analog.name}</b><i>${r.analog.region}</i>` +
          `<i class="coord">${coords}${r.analog.discovered ? ' · discovered cell' : ''}</i></span>` +
        `<span class="scol"><span class="sc">${Math.round(r.total)}%</span>${certaintyHtml(r)}</span>` +
        `<span class="bar"><i style="width:${Math.round(r.total)}%"></i></span>` +
      '</button></li>'
    );
  }).join('') : '';
}

export function updatePair() {
  const t = curTarget();
  const r = state.ranked.find((x) => x.analog.id === state.analogId);
  if (!r || !t) {
    $('#pairNames').textContent = t?.custom
      ? `${t.name} · ${t.measurementStatus === 'loading' ? 'retrieving planetary data�' : 'planetary data unavailable'}`
      : state.customEarthPoint
        ? `${state.customEarthPoint.name} · Earth data unavailable`
        : 'Select a target and a measured Earth match';
    $('#pairScore').textContent = '—';
    $('#pairRing').style.setProperty('--p', 0);
    $('#pairRing').title = 'No active target and match';
    return;
  }
  $('#pairNames').innerHTML =
    `<span class="sp">${t.name}</span><span class="ar">⇄</span><span class="ea">${r.analog.name}</span>`;
  $('#pairScore').textContent = Math.round(r.total) + '%';
  $('#pairRing').style.setProperty('--p', Math.round(r.total));
  const interval = r.scoreInterval ? ` · 95% interval ${r.scoreInterval[0]}–${r.scoreInterval[1]}%` : '';
  $('#pairRing').title = 'Data coverage ' + Math.round((r.coverage ?? 0) * 100) +
    '% · confidence ' + Math.round(r.confidence ?? 0) + '%' +
    ' · certainty ' + (r.certaintyLabel || 'unknown') +
    (r.uncertainty?.sigma != null ? ' (±' + Math.round(r.uncertainty.sigma) + ' pts)' : '') + interval;
}
