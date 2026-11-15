import { $ } from '../utils/dom.js';
import { state, curTarget } from '../core/state.js';
import { fmtCoords } from '../utils/format.js';
import { DISCOVERY, FACTORS } from '../data/index.js';

export function earthRegionFor(lat, lon) {
  if (lat <= -60) return 'Antarctica';
  if (lat >= -35 && lat <= 37 && lon >= -20 && lon <= 55) return 'Africa';
  if (lat >= 35 && lat <= 82 && lon >= -25 && lon <= 60) return 'Europe';
  if (lat >= -10 && lat <= 82 && lon >= 25 && lon <= 180) return 'Asia';
  if (lat >= 5 && lon >= -170 && lon < -50) return 'North America';
  if (lat >= -60 && lat <= 15 && lon >= -85 && lon <= -30) return 'South America';
  if (lat >= -50 && lat <= 0 && lon >= 110 && lon <= 180) return 'Oceania';
  return 'Other regions';
}

export function visibleRanked(ranked = state.ranked) {
  return state.earthRegion === 'all' ? ranked : ranked.filter((entry) => earthRegionFor(entry.analog.lat, entry.analog.lon) === state.earthRegion);
}

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

const bodyLabel = (body) => body === 'mars' ? 'Mars' : body === 'moon' ? 'Moon' : 'planetary';

/** Number of scoring factors actually measured, not the number of placeholders. */
function presentCount(target) {
  const values = target?.measurements?.values || {};
  const keys = new Set(FACTORS.map((factor) => factor.k));
  return Object.entries(values)
    .filter(([key, value]) => keys.has(key) && value && Number.isFinite(value.value))
    .length;
}

export function renderResults() {
  const target = curTarget();
  const earthPoint = state.customEarthPoint;
  const visible = visibleRanked();
  const selected = visible.find((entry) => entry.analog.id === state.analogId);
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
        ? `Retrieving coordinate-specific ${bodyLabel(target.body)} measurements before comparing candidates…`
        : target.measurementStatus === 'validated'
          ? state.ranked.length
            ? `${target.measurements.source.name}; ${target.measurements.source.period}. ${presentCount(target)} of 7 factors available; ranked against ${DISCOVERY.candidates.length} measured Earth cells from the current ${DISCOVERY.grid.stepDegrees}° discovery snapshot using current weights. This is not an exhaustive Earth grid, and planetary differences are reported separately.`
            : 'No scientifically supportable candidate regions were identified from the currently available datasets.'
          : state.researchError || 'No validated planetary measurements are available for this coordinate.'
      : earthPoint
        ? earthPoint.measurementStatus === 'validated'
          ? `NASA POWER / MERRA-2 ${earthPoint.measurements.source.period} at the selected coordinate; ranking only against the currently selected planetary target and using shared measured parameters.`
          : state.researchError || 'Retrieving coordinate-specific NASA POWER measurements before comparison…'
      : target
        ? `${n} candidate cells from a global ${DISCOVERY.grid.stepDegrees}° land grid (${DISCOVERY.generatedAt || 'date unavailable'}); scores recalculated for this target and current weights. This is a regional screening grid, not every named Earth site.`
        : 'Select a measured target on the left or its pin, or click a coordinate on either globe.';
    if (state.earthRegion !== 'all' && target && state.ranked.length) {
      meta.textContent = visible.length
        ? `${visible.length} measured Earth match${visible.length === 1 ? '' : 'es'} in ${state.earthRegion}; ranked from the available discovered cells using current weights.`
        : `No measured Earth matches in ${state.earthRegion}. Choose another region or All Earth regions.`;
    }
    if (meta && DISCOVERY.unavailableDatasets?.length) {
      const errors = DISCOVERY.unavailableDatasets.map((item) => `${item.name || item.id}: ${item.count} unavailable`).join('; ');
      meta.textContent += ` Source failures or coverage gaps were recorded and affected cells/features are excluded: ${errors}.`;
    }
  }

  const overview = $('#resOverview');
  if (overview) {
    const buttonExport = $('#exportAnalysis');
    const buttonRerun = $('#rerunAnalysis');
    if (buttonExport) buttonExport.disabled = !selected || !target;
    if (buttonRerun) buttonRerun.disabled = !target;
    if (!target) overview.textContent = 'Choose a planetary target or select a coordinate to calculate a current comparison.';
    else if (target.custom && target.measurementStatus === 'loading') overview.textContent = 'Retrieving measurements for the selected coordinate. A score will appear only after the source data passes validation.';
    else if (target.custom && target.measurementStatus !== 'validated') overview.textContent = state.researchError || 'No validated measurement set is available for this coordinate.';
    else if (!selected) overview.textContent = state.earthRegion === 'all' ? 'No scientifically supportable candidate regions were identified from the currently available datasets.' : `No measured candidates are available in ${state.earthRegion}.`;
    else {
      const measured = selected.parts.filter((part) => part.valid && !part.na).sort((a, b) => b.sim - a.sim);
      const closest = measured[0];
      const weakest = measured[measured.length - 1];
      overview.textContent = `${Math.round(selected.total)}% similarity · ${Math.round(selected.coverage * 100)}% data coverage · ${Math.round(selected.confidence)}% confidence. ${closest ? `Closest factor: ${closest.f.label} (${Math.round(closest.sim)}%).` : 'No shared factors.'} ${weakest && weakest !== closest ? `Largest gap: ${weakest.f.label} (${Math.round(weakest.sim)}%).` : ''}`;
    }
  }

  $('#resultList').innerHTML = target && (!target.custom || target.measurementStatus === 'validated') ? visible.slice(0, 6).map((r, i) => {
    const coverage = Math.round((r.coverage ?? 0) * 100);
    const confidence = Math.round(r.confidence ?? 0);
    const provisional = r.status && r.status !== 'ok' ? ' · provisional' : '';
    const coords = fmtCoords(r.analog.lat, r.analog.lon, r.analog.custom ? 5 : 1);
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
  const r = visibleRanked().find((x) => x.analog.id === state.analogId);
  if (!r || !t) {
    $('#pairNames').textContent = t?.custom
      ? `${t.name} · ${t.measurementStatus === 'loading' ? 'retrieving planetary data…' : 'planetary data unavailable'}`
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
