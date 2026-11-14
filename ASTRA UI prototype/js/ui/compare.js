import { $ } from '../utils/dom.js';
import { state, curTarget } from '../core/state.js';
import {
  tier,
  ENGINE_VERSION,
  PROFILE_ORDER
} from '../core/scoring.js';
import { fmt, fmtUncertainty, fmtCoords } from '../utils/format.js';
import { makeTerrain, sizeTerrain, drawTerrain } from '../graphics/terrain.js';
import { nonReplicableFor } from '../data/planetary.js';

/**
 * Compare screen: two site cards with terrain previews, a weighted score
 * breakdown, score uncertainty, independent profile scores, the weakest
 * factors, evidence/provenance, and the differences no Earth site can remove.
 *
 * The visual system is the ASTRA prototype: same panels, type scale, tokens
 * and terrain previews. The additions are data, not a redesign.
 */

let terrains = [];

/** Escape every value that can come from an API or a generated snapshot. */
function esc(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function factRows(site) {
  const rows = [
    ['Temperature', 'temp', site.v.temp],
    ['Solar illumination', 'solar', site.v.solar],
    ['Ice and water', 'ice', site.v.ice],
    ['Volcanic soil', 'soil', site.v.soil],
    ['Terrain roughness', 'terrain', site.v.terrain],
    ['Dryness', 'dry', site.v.dry],
    ['Lava-tube access', 'tube', site.v.tube]
  ];
  return '<dl class="facts">' + rows.map(([label, key, value]) => {
    const sigma = fmtUncertainty(key, value);
    return `<div><dt>${label}</dt><dd>${fmt(key, value)}${sigma ? ` <span class="u">${sigma}</span>` : ''}</dd></div>`;
  }).join('') + '</dl>';
}

function unavailableText(part) {
  if (part.reason === 'not_applicable') return 'Target has no mapped tube';
  if (part.reason === 'missing_target') return 'No target data';
  if (part.reason === 'missing_data') return 'No comparable data';
  return 'Not used';
}

/** Up to two sentence-sized explanations for the lowest-scoring factors. */
function weakPoints(r, t) {
  return r.parts
    .filter((p) => p.valid && !p.na && p.wt > 0 && p.sim < 65)
    .sort((a, b) => a.sim - b.sim)
    .slice(0, 2)
    .map((p) => {
      if (p.f.k === 'temp') {
        return p.f.label + ': the Earth site is ' + (p.a > p.t ? 'warmer' : 'colder') +
          ' by ' + Math.abs(Math.round((p.a - p.t) * 10) / 10) + ' °C (' +
          fmt('temp', p.a) + ' vs ' + fmt('temp', p.t) + ').';
      }
      if (p.f.k === 'solar') {
        return p.f.label + ': the Earth site receives ' + fmt('solar', p.a) +
          ' vs ' + fmt('solar', p.t) + ' at the target.';
      }
      if (p.f.k === 'tube') {
        return p.f.label + ': the Earth site scores ' + fmt('tube', p.a) + ', the target needs a tube.';
      }
      return p.f.label + ': ' + (p.a > p.t ? 'higher' : 'lower') +
        ' at the Earth site (' + fmt(p.f.k, p.a) + ' vs ' + fmt(p.f.k, p.t) + ').';
    });
}

function profileText(profiles) {
  if (!profiles) return [];
  return PROFILE_ORDER
    .filter((id) => profiles[id])
    .map((id) => {
      const p = profiles[id];
      const score = p.score == null ? 'not available' : Math.round(p.score) + '%';
      return `${p.label}: ${score} (coverage ${Math.round(p.coverage * 100)}%, confidence ${Math.round(p.confidence)}%)`;
    });
}

/** Evidence trail for the Earth candidate, one row per measured feature. */
function provenanceHtml(analog) {
  const items = (analog.provenance || []).map((entry) => {
    const source = entry.source || {};
    const link = source.url
      ? ` <a href="${esc(source.url)}" target="_blank" rel="noopener noreferrer">source</a>`
      : '';
    const unit = entry.unit ? ` ${esc(entry.unit)}` : '';
    const sigma = entry.uncertainty != null ? ` ±${esc(entry.uncertainty)}` : '';
    return `<li><b>${esc(source.name || entry.key)}</b> — ${esc(entry.key)} ${esc(entry.value)}${unit}${sigma}${link}` +
      (entry.note ? `<span>${esc(entry.note)}</span>` : '') + '</li>';
  });
  if (!items.length) return '<p class="cap">No provenance recorded for this cell.</p>';
  return '<details class="prov"><summary>Evidence and provenance</summary><ul>' +
    items.join('') + '</ul></details>';
}

function targetEvidenceHtml(target) {
  const measurements = target.measurements;
  if (!measurements?.values) return '';
  const source = measurements.source;
  return `<details class="prov" open><summary>Planetary data and model context</summary>` +
    `<p>${esc(source.name)} · ${esc(source.period)} · ${esc(source.resolution)}</p>` +
    `<ul><li>Surface temperature: ${esc(measurements.values.temp.value.toFixed(2))} °C; seasonal spread ±${esc(measurements.values.temp.seasonalSpread.toFixed(2))} °C (${esc(measurements.completeness.temp)})</li>` +
    `<li>Surface solar flux: ${esc(measurements.values.solar.value.toFixed(3))} kWh/m²/day; seasonal spread ±${esc(measurements.values.solar.seasonalSpread.toFixed(3))} (${esc(measurements.completeness.solar)})</li>` +
    `<li>Surface pressure: ${esc(measurements.values.pressureKpa.value.toFixed(3))} kPa; seasonal spread ±${esc(measurements.values.pressureKpa.seasonalSpread.toFixed(3))} kPa (${esc(measurements.completeness.pressure)})</li></ul>` +
    '<p class="cap">MCD does not provide a pointwise statistical uncertainty estimate; seasonal spread is reported separately and is not presented as model error.</p>' +
    `<a href="${esc(source.reference)}" target="_blank" rel="noopener noreferrer">Retrieved source data</a> · <a href="${esc(source.url)}" target="_blank" rel="noopener noreferrer">MCD documentation</a></details>`;
}

function nonReplicableHtml(list) {
  if (!list || !list.length) return '<p class="cap">No planetary difference table available for this body.</p>';
  return '<div class="nr-grid">' + list.map((d) => {
    const ratio = d.ratio == null ? '' : ` · ${(Math.round(d.ratio * 1000) / 1000)}× Earth`;
    const sources = (d.sources || []).map((source) =>
      `<a href="${esc(source.url)}" target="_blank" rel="noopener noreferrer">${esc(source.name)}</a>`
    ).join(' · ');
    return '<article class="nr-card">' +
      `<div class="nr-hd"><b>${esc(d.label)}</b><span class="sev ${esc(d.severity)}">${esc(d.severity)}</span></div>` +
      `<p class="nr-values">Earth ${esc(d.earth_display)} <span>→</span> ${esc(d.target_display)}${ratio}</p>` +
      `<p>${esc(d.why)}</p>` +
      `<p class="nr-consequence"><b>Consequence.</b> ${esc(d.consequence)}</p>` +
      `<p class="cap">${esc(d.mitigation)}</p>` +
      (sources ? `<p class="cap">Sources: ${sources}</p>` : '') +
      '</article>';
  }).join('') + '</div>';
}

function summaryText(r, t) {
  const a = r.analog;
  const lines = [
    'Analog match: ' + t.name + ' (' + t.body + ') vs ' + a.name + ' (' + a.region + ')',
    'Coordinates: ' + (fmtCoords(a.lat, a.lon) || 'n/a'),
    'Score: ' + Math.round(r.total) + '% (' + tier(r.total) + ')' +
      (r.scoreInterval ? ' · 95% interval ' + r.scoreInterval[0] + '–' + r.scoreInterval[1] + '%' : ''),
    'Score uncertainty: ' + (r.uncertainty?.sigma != null ? '±' + r.uncertainty.sigma + ' pts' : 'not available') +
      ' · certainty ' + (r.certaintyLabel || 'unknown'),
    'Coverage: ' + Math.round(r.coverage * 100) + '% of requested feature weight',
    'Confidence: ' + Math.round(r.confidence) + '% (' + r.confidenceLabel + ')',
    'Status: ' + r.status,
    '',
    'Factor | target | Earth site | similarity | distance | weight'
  ];
  r.parts.forEach((p) => {
    lines.push(
      p.f.label + ' | ' + fmt(p.f.k, p.t) + ' | ' + fmt(p.f.k, p.a) + ' | ' +
      (p.na ? unavailableText(p) : Math.round(p.sim) + '%') + ' | ' +
      (p.d == null ? '—' : p.d.toFixed(2)) + ' | ' + (p.na ? '-' : p.wt)
    );
  });
  lines.push('');
  lines.push('Profile scores:');
  profileText(r.profiles).forEach((line) => lines.push('  ' + line));
  weakPoints(r, t).forEach((x) => lines.push('Weak point: ' + x));
  if (a.limitations && a.limitations.length) {
    lines.push('');
    lines.push('Site limitations:');
    a.limitations.forEach((x) => lines.push('  - ' + x));
  }
  if (r.nonReplicable && r.nonReplicable.length) {
    lines.push('');
    lines.push('Not replicable on Earth:');
    r.nonReplicable.forEach((d) => lines.push('  - ' + d.label + ': Earth ' + d.earth_display +
      ' vs ' + d.target_display + '. ' + d.why));
  }
  if (a.provenance && a.provenance.length) {
    lines.push('');
    lines.push('Data sources:');
    [...new Set(a.provenance.map((entry) => entry.source?.name).filter(Boolean))]
      .forEach((name) => lines.push('  - ' + name));
  }
  if (r.warnings && r.warnings.length) {
    lines.push('');
    lines.push('Warnings:');
    r.warnings.forEach((warning) => lines.push('  - ' + warning));
  }
  lines.push('');
  lines.push('Engine v' + (r.engineVersion || ENGINE_VERSION) + ' · config ' + (r.configVersion || ''));
  lines.push('Similarity is relative to the selected features and weights. Differences listed above are not removable by site choice.');
  return lines.join('\n');
}

export function renderCompare({ onBack } = {}) {
  const back = typeof onBack === 'function' ? onBack : () => {};
  const t = curTarget();
  if (!t) {
    $('#viewCompare').innerHTML =
      '<section class="panel"><h2>Choose a planetary target</h2>' +
      '<p class="cap">Select a measured Moon or Mars location before comparing Earth matches.</p>' +
      '<button type="button" class="cta" data-back>Choose target</button></section>';
    $('#viewCompare [data-back]').addEventListener('click', back);
    return;
  }
  const r = state.ranked.find((x) => x.analog.id === state.analogId) || state.ranked[0];
  if (!r) {
    if (t?.custom || state.customEarthPoint) {
      const differences = nonReplicableHtml(nonReplicableFor(t?.body || state.mode));
      const measured = t?.measurements;
      const measurementRows = measured?.values
        ? `<dl class="facts"><div><dt>Surface temperature</dt><dd>${fmt('temp', measured.values.temp)} <span class="u">modelled, seasonal/diurnal climatology</span></dd></div>` +
          `<div><dt>Surface solar flux</dt><dd>${fmt('solar', measured.values.solar)}</dd></div>` +
          `<div><dt>Surface pressure</dt><dd>${measured.values.pressureKpa.value.toFixed(3)} kPa</dd></div></dl>`
        : `<p class="cap">${esc(state.researchError || 'Coordinate measurements are still loading.')}</p>`;
      $('#viewCompare').innerHTML =
        '<section class="panel"><h2>No ranked match is available</h2>' +
        '<p class="cap">The selected point is not assigned a similarity score until planetary data is validated. When available, the score uses comparable measured factors only.</p>' +
        measurementRows +
        '<p class="cap">Planetary differences are independent of the location score and cannot be reproduced by choosing an Earth site.</p>' + differences +
        '<button type="button" class="cta" data-back>Back to globe</button></section>';
      $('#viewCompare [data-back]').addEventListener('click', back);
      return;
    }
    $('#viewCompare').innerHTML =
      '<section class="panel"><h2>No discovered sites</h2>' +
      '<p class="cap">Run <code>node tools/discover.mjs</code> to generate <code>js/data/discovered.js</code>, then reload.</p></section>';
    return;
  }
  const a = r.analog;
  const hue = state.mode === 'moon' ? 199 : 24;
  const sp = state.mode === 'moon' ? 'Moon' : 'Mars';
  const weak = weakPoints(r, t);
  const coverage = Math.round((r.coverage ?? 0) * 100);
  const confidence = Math.round(r.confidence ?? 0);
  const warnings = r.warnings ?? [];
  const limitations = a.limitations ?? [];
  const statusNote = r.status === 'ok'
    ? ''
    : r.status === 'no_weights'
      ? 'No feature weights are active, so no weighted score can be computed.'
      : r.status === 'no_comparable_features'
        ? 'No comparable features were available for this pair.'
        : r.status === 'insufficient_coverage'
          ? 'Data coverage is below the minimum. Treat this score as provisional.'
          : 'Too few comparable features were available. Treat this score as provisional.';

  const brk = r.parts.map((p) => {
    if (!p.valid || p.na) {
      return (
        '<div class="brow na">' +
          `<div class="hd"><b>${esc(p.f.label)}</b><em>not used</em></div>` +
          '<div class="track"><i></i></div>' +
          `<div class="sub"><span>${unavailableText(p)}</span><span>weight 0</span></div>` +
        '</div>'
      );
    }

    const col = p.sim >= 70 ? 'var(--earth)' : p.sim >= 45 ? 'var(--warn)' : 'var(--bad)';
    const sigma = r.uncertainty?.perFeature?.[p.f.k]?.sigma_points;
    return (
      '<div class="brow">' +
        `<div class="hd"><b>${esc(p.f.label)}</b><em>${Math.round(p.sim)}%</em></div>` +
        `<div class="track"><i style="width:${Math.round(p.sim)}%;background:${col}"></i></div>` +
        `<div class="sub"><span>${fmt(p.f.k, p.t)} → ${fmt(p.f.k, p.a)}</span>` +
        `<span>d ${p.d == null ? '—' : p.d.toFixed(2)} · w ${p.wt}` +
        `${sigma != null ? ` · ±${Math.round(sigma)} pts` : ''}</span></div>` +
      '</div>'
    );
  }).join('');

  const profileHtml = PROFILE_ORDER
    .filter((id) => r.profiles && r.profiles[id])
    .map((id) => {
      const p = r.profiles[id];
      const value = p.score == null ? '—' : Math.round(p.score) + '%';
      const limited = p.status === 'ok' ? '' : ' limited';
      return (
        `<div class="pchip${limited}" title="${esc(p.caveat || '')}">` +
          `<span>${esc(p.label)}</span><b>${value}</b>` +
          `<i>coverage ${Math.round(p.coverage * 100)}%</i>` +
        '</div>'
      );
    }).join('');

  const weakHtml = weak.map((x) => `<li>${esc(x)}</li>`).join('') +
    (limitations.length
      ? limitations.map((x) => `<li class="global">${esc(x)}</li>`).join('')
      : '<li class="global">No site-specific limitations recorded.</li>');

  const warningsHtml = warnings.length
    ? '<ul class="warnlist">' + warnings.map((warning) => `<li>${esc(warning)}</li>`).join('') + '</ul>'
    : '<p class="cap">No additional data warnings for this pair.</p>';

  const interval = r.scoreInterval ? `${r.scoreInterval[0]}–${r.scoreInterval[1]}%` : '—';

  $('#viewCompare').innerHTML =
    '<div class="cmp-head">' +
      '<button type="button" class="back" id="backBtn">← Back to globes</button>' +
      `<h2 class="cmp-title"><span class="sp">${esc(t.name)}</span><span class="ar">⇄</span><span class="ea">${esc(a.name)}</span></h2>` +
      `<div class="scorebig"><b>${Math.round(r.total)}%</b><span>${tier(r.total)}` +
        `${r.uncertainty?.sigma != null ? ` · ±${Math.round(r.uncertainty.sigma)} pts` : ''}</span></div>` +
    '</div>' +

    '<div class="cmp-grid">' +
      `<article class="panel site site-space">
        <span class="eyebrow">${sp} · Space target</span>
        <h3>${esc(t.name)}</h3>
        <p class="region">${esc(t.region)}</p>
        <canvas class="terrain" id="tcSpace" aria-label="Terrain preview of ${esc(t.name)}" role="img"></canvas>
        <p class="cap">Generated terrain preview. Drag to turn it.</p>
        ${factRows(t)}
        ${targetEvidenceHtml(t)}
        <p class="goal"><b>Mission goal</b>${esc(t.goal)}</p>
      </article>` +
      `<section class="panel">
        <span class="eyebrow">Score breakdown</span>
        <h2>Why ${Math.round(r.total)}%</h2>
        <p class="scoremeta">Weighted distance ${r.normalizedDistance == null ? '—' : r.normalizedDistance.toFixed(2)} · coverage ${coverage}% · confidence ${confidence}% · certainty ${r.certaintyLabel || 'unknown'}</p>
        ${statusNote ? `<p class="alert">${statusNote}</p>` : ''}
        ${brk}
        <div class="uncert">
          <span class="eyebrow">Score uncertainty</span>
          <div class="metrics">
            <div><span>Score</span><b>${Math.round(r.total)}%</b></div>
            <div><span>95% interval</span><b>${interval}</b></div>
            <div><span>1σ</span><b>${r.uncertainty?.sigma != null ? '±' + r.uncertainty.sigma + ' pts' : '—'}</b></div>
          </div>
          <p class="cap">${esc(r.uncertainty?.method || 'Uncertainty could not be propagated for this pair.')}</p>
        </div>
        <div class="profile-block">
          <span class="eyebrow">Profile scores</span>
          <div class="profile-grid">${profileHtml}</div>
          <p class="cap">Fixed-weight views of the same feature distances. They do not change the ranking above.</p>
        </div>
      </section>` +
      `<article class="panel site site-earth">
        <span class="eyebrow">Earth analog · discovered</span>
        <h3>${esc(a.name)}</h3>
        <p class="region">${esc(a.region)} · ${esc(fmtCoords(a.lat, a.lon))}</p>
        <canvas class="terrain" id="tcEarth" aria-label="Terrain preview of ${esc(a.name)}" role="img"></canvas>
        <p class="cap">Generated terrain preview. Drag to turn it.</p>
        ${factRows(a)}
        <p class="goal"><b>Measured environment</b>${esc(a.summary || 'No summary recorded.')}</p>
        ${provenanceHtml(a)}
      </article>` +
    '</div>' +

    '<div class="cmp-foot">' +
      `<section class="panel weak">
        <span class="eyebrow">Where this match is weak</span>
        <ul>${weakHtml}</ul>
      </section>` +
      `<section class="panel">
        <span class="eyebrow">Data coverage and confidence</span>
        <div class="metrics">
          <div><span>Coverage</span><b>${coverage}%</b></div>
          <div><span>Confidence</span><b>${confidence}%</b></div>
          <div><span>Certainty</span><b>${r.certaintyLabel || 'Unknown'}</b></div>
        </div>
        <div class="conf">
          <span><span class="badge ${esc(t.conf)}">${esc(t.conf)}</span> target documentation</span>
          <span><span class="badge ${esc(a.conf)}">${esc(a.conf)}</span> Earth site documentation</span>
        </div>
        <p class="explain">${esc(r.explanation || '')}</p>
        ${warningsHtml}
        <div class="actions">
          <button type="button" class="cta" id="copyBtn">Copy summary</button>
          <button type="button" class="ghost" id="backBtn2">Pick another site</button>
          <span class="status" id="copyStatus" role="status"></span>
        </div>
        <textarea id="copyOut" readonly hidden aria-label="Summary text"></textarea>
      </section>` +
    '</div>' +

    '<section class="panel nr">' +
      '<span class="eyebrow">What this analog cannot replicate</span>' +
      `<h2>${r.nonReplicable?.length ?? 0} differences no Earth site can remove</h2>` +
      '<p class="cap">These are planetary properties, not site-selection failures. They are listed beside the score so a high similarity is never read as a full environment match.</p>' +
      nonReplicableHtml(r.nonReplicable) +
    '</section>';

  terrains = [makeTerrain($('#tcSpace'), t.tp, hue), makeTerrain($('#tcEarth'), a.tp, 160)];

  $('#backBtn').onclick = back;
  $('#backBtn2').onclick = back;

  $('#copyBtn').onclick = () => {
    const txt = summaryText(r, t);
    const st = $('#copyStatus');
    const ta = $('#copyOut');
    const fallback = () => {
      ta.hidden = false;
      ta.value = txt;
      ta.focus();
      ta.select();
      st.textContent = 'Select and copy the text below.';
    };
    try {
      navigator.clipboard.writeText(txt).then(() => {
        st.textContent = 'Copied';
        setTimeout(() => { st.textContent = ''; }, 2500);
      }, fallback);
    } catch (_) {
      fallback();
    }
  };
}

/* Terrain lifecycle, driven by the frame loop and resize handler. */

export function drawTerrains(now) {
  terrains.forEach((T) => drawTerrain(T, now));
}

export function resizeTerrains() {
  terrains.forEach(sizeTerrain);
}

export function clearTerrains() {
  terrains = [];
}
