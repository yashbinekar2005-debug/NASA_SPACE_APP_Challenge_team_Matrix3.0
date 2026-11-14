import { $ } from '../utils/dom.js';
import { state, curTarget } from '../core/state.js';
import {
  tier,
  ENGINE_VERSION,
  PROFILE_ORDER
} from '../core/scoring.js';
import { fmt } from '../utils/format.js';
import { makeTerrain, sizeTerrain, drawTerrain } from '../graphics/terrain.js';

/**
 * Compare screen: two site cards with terrain previews, a weighted score
 * breakdown, independent profile scores, the weakest factors, coverage and
 * confidence, and a copyable summary.
 */

let terrains = [];

function factRows(site) {
  const rows = [
    ['Temperature', fmt('temp', site.v.temp)],
    ['Ice and water', fmt('ice', site.v.ice)],
    ['Soil', site.soilDesc + ' · ' + fmt('soil', site.v.soil)],
    ['Terrain', site.terrainDesc + ' · ' + fmt('terrain', site.v.terrain)],
    ['Dryness', fmt('dry', site.v.dry)],
    ['Lava-tube access', fmt('tube', site.v.tube)]
  ];
  return '<dl class="facts">' + rows.map((r) => `<div><dt>${r[0]}</dt><dd>${r[1]}</dd></div>`).join('') + '</dl>';
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
          ' by ' + Math.abs(p.a - p.t) + ' °C (' + fmt('temp', p.a) + ' vs ' + fmt('temp', p.t) + ').';
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

function summaryText(r, t) {
  const lines = [
    'Analog match: ' + t.name + ' (' + t.body + ') vs ' + r.analog.name + ' (' + r.analog.region + ')',
    'Score: ' + Math.round(r.total) + '% (' + tier(r.total) + ')',
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
  if (r.warnings && r.warnings.length) {
    lines.push('');
    lines.push('Warnings:');
    r.warnings.forEach((warning) => lines.push('  - ' + warning));
  }
  lines.push('');
  lines.push('Engine v' + (r.engineVersion || ENGINE_VERSION) + ' · config ' + (r.configVersion || ''));
  lines.push('Note: prototype data. Similarity is relative to the selected features and weights.');
  return lines.join('\n');
}

export function renderCompare({ onBack } = {}) {
  const back = typeof onBack === 'function' ? onBack : () => {};
  const t = curTarget();
  const r = state.ranked.find((x) => x.analog.id === state.analogId) || state.ranked[0];
  const a = r.analog;
  const hue = state.mode === 'moon' ? 199 : 24;
  const sp = state.mode === 'moon' ? 'Moon' : 'Mars';
  const weak = weakPoints(r, t);
  const coverage = Math.round((r.coverage ?? 0) * 100);
  const confidence = Math.round(r.confidence ?? 0);
  const warnings = r.warnings ?? [];
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
          `<div class="hd"><b>${p.f.label}</b><em>not used</em></div>` +
          '<div class="track"><i></i></div>' +
          `<div class="sub"><span>${unavailableText(p)}</span><span>weight 0</span></div>` +
        '</div>'
      );
    }

    const col = p.sim >= 70 ? 'var(--earth)' : p.sim >= 45 ? 'var(--warn)' : 'var(--bad)';
    return (
      '<div class="brow">' +
        `<div class="hd"><b>${p.f.label}</b><em>${Math.round(p.sim)}%</em></div>` +
        `<div class="track"><i style="width:${Math.round(p.sim)}%;background:${col}"></i></div>` +
        `<div class="sub"><span>${fmt(p.f.k, p.t)} → ${fmt(p.f.k, p.a)}</span>` +
        `<span>d ${p.d == null ? '—' : p.d.toFixed(2)} · weight ${p.wt}</span></div>` +
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
        `<div class="pchip${limited}" title="${p.caveat || ''}">` +
          `<span>${p.label}</span><b>${value}</b>` +
          `<i>coverage ${Math.round(p.coverage * 100)}%</i>` +
        '</div>'
      );
    }).join('');

  const weakHtml = weak.map((x) => `<li>${x}</li>`).join('') +
    '<li class="global">Earth has 1 g of gravity, a thick atmosphere and a magnetic field. ' +
    'No Earth site can copy the Moon or Mars on these.</li>';

  const warningsHtml = warnings.length
    ? '<ul class="warnlist">' + warnings.map((warning) => `<li>${warning}</li>`).join('') + '</ul>'
    : '<p class="cap">No additional data warnings for this pair.</p>';

  $('#viewCompare').innerHTML =
    '<div class="cmp-head">' +
      '<button type="button" class="back" id="backBtn">← Back to globes</button>' +
      `<h2 class="cmp-title"><span class="sp">${t.name}</span><span class="ar">⇄</span><span class="ea">${a.name}</span></h2>` +
      `<div class="scorebig"><b>${Math.round(r.total)}%</b><span>${tier(r.total)}</span></div>` +
    '</div>' +

    '<div class="cmp-grid">' +
      `<article class="panel site site-space">
        <span class="eyebrow">${sp} · Space target</span>
        <h3>${t.name}</h3>
        <p class="region">${t.region}</p>
        <canvas class="terrain" id="tcSpace" aria-label="Terrain preview of ${t.name}" role="img"></canvas>
        <p class="cap">Generated terrain preview. Drag to turn it.</p>
        ${factRows(t)}
        <p class="goal"><b>Mission goal</b>${t.goal}</p>
      </article>` +
      `<section class="panel">
        <span class="eyebrow">Score breakdown</span>
        <h2>Why ${Math.round(r.total)}%</h2>
        <p class="scoremeta">Weighted distance ${r.normalizedDistance == null ? '—' : r.normalizedDistance.toFixed(2)} · coverage ${coverage}% · confidence ${confidence}%</p>
        ${statusNote ? `<p class="alert">${statusNote}</p>` : ''}
        ${brk}
        <div class="profile-block">
          <span class="eyebrow">Profile scores</span>
          <div class="profile-grid">${profileHtml}</div>
          <p class="cap">Fixed-weight views of the same feature distances. They do not change the ranking above.</p>
        </div>
      </section>` +
      `<article class="panel site site-earth">
        <span class="eyebrow">Earth analog</span>
        <h3>${a.name}</h3>
        <p class="region">${a.region}</p>
        <canvas class="terrain" id="tcEarth" aria-label="Terrain preview of ${a.name}" role="img"></canvas>
        <p class="cap">Generated terrain preview. Drag to turn it.</p>
        ${factRows(a)}
        <p class="goal"><b>Why space agencies test here</b>${a.why}</p>
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
          <div><span>Level</span><b>${r.confidenceLabel || 'Unknown'}</b></div>
        </div>
        <div class="conf">
          <span><span class="badge ${t.conf}">${t.conf}</span> target documentation</span>
          <span><span class="badge ${a.conf}">${a.conf}</span> Earth site documentation</span>
        </div>
        <p class="explain">${r.explanation || ''}</p>
        ${warningsHtml}
        <div class="actions">
          <button type="button" class="cta" id="copyBtn">Copy summary</button>
          <button type="button" class="ghost" id="backBtn2">Pick another site</button>
          <span class="status" id="copyStatus" role="status"></span>
        </div>
        <textarea id="copyOut" readonly hidden aria-label="Summary text"></textarea>
      </section>` +
    '</div>';

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
