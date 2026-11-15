import { pointImage } from '../core/imagery.js';
import { state } from '../core/state.js';

const escapeHtml = (value) => String(value == null ? '' : value)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const factorLabels = [
  ['temp', 'Temperature'], ['solar', 'Solar illumination'], ['ice', 'Ice / water evidence'],
  ['soil', 'Soil / composition proxy'], ['terrain', 'Terrain roughness'], ['dry', 'Dryness evidence'],
  ['tube', 'Cave / tube capability']
];

function table(rows, headings = ['Item', 'Measured value', 'Source / period']) {
  return `<div class="report-table-wrap"><table class="report-table"><thead><tr>${headings.map((heading) => `<th>${escapeHtml(heading)}</th>`).join('')}</tr></thead><tbody>${rows.map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}

function earthRows(site) {
  const ctx = site.siteContext || {};
  const climate = ctx.climate || {};
  const annual = climate.annual || {};
  const atmo = ctx.atmosphere || {};
  const land = ctx.land || {};
  const period = climate.period || 'not recorded';
  const source = climate.source?.name || 'NASA POWER / MERRA-2';
  const rows = [
    ['Coordinates (WGS84)', `${site.lat}, ${site.lon}`, 'Stored global grid-cell centre'],
    ['Place label', `${site.name || 'Unnamed cell'}${site.region ? ` · ${site.region}` : ''}`, 'Reverse geocoder; label only'],
    ['Screening cell width', site.cellDegrees ? `${site.cellDegrees}°` : 'Point query', 'Discovery grid; local variation may differ'],
    ['Elevation', Number.isFinite(land.elevationM) ? `${land.elevationM} m` : 'Unavailable', 'NASA POWER point response'],
    ['Surface temperature, annual mean', Number.isFinite(annual.ts) ? `${annual.ts} °C` : 'Unavailable', `${source} · ${period} · ${climate.spatialResolution || 'resolution not recorded'}`],
    ['Air temperature, annual mean', Number.isFinite(annual.t2m) ? `${annual.t2m} °C` : 'Unavailable', `${source} · ${period}`],
    ['Air temperature min / max', Number.isFinite(annual.t2mMin) && Number.isFinite(annual.t2mMax) ? `${annual.t2mMin} / ${annual.t2mMax} °C` : 'Unavailable', `${source} · ${period}`],
    ['Precipitation', Number.isFinite(annual.precipMmDay) ? `${(annual.precipMmDay * 365).toFixed(1)} mm/year; ${annual.precipMmDay} mm/day` : 'Unavailable', `${source} · ${period}`],
    ['Relative humidity at 2 m', Number.isFinite(atmo.relativeHumidityPercent) ? `${atmo.relativeHumidityPercent}%` : 'Unavailable', `${source} · ${atmo.period || period}`],
    ['Surface pressure', Number.isFinite(atmo.pressureKpa) ? `${atmo.pressureKpa} kPa` : 'Unavailable', `${source} · ${atmo.period || period}`],
    ['Wind at 2 m', Number.isFinite(atmo.windSpeedMs) ? `${atmo.windSpeedMs} m/s` : 'Unavailable', `${source} · ${atmo.period || period}`],
    ['Aerosol optical depth (AOD_55 at 0.55 µm)', Number.isFinite(ctx.dust?.aerosolOpticalDepth055) ? `${ctx.dust.aerosolOpticalDepth055} dimensionless` : 'Unavailable', `${ctx.dust?.source?.name || 'NASA POWER AOD_55'} · ${ctx.dust?.source?.period || 'period not recorded'} · ${ctx.dust?.source?.resolution || 'resolution not recorded'}${ctx.dust?.reason ? ` · ${ctx.dust.reason}` : ''}`],
    ['Mineral-dust concentration', 'Not isolated by AOD_55', 'Total column aerosol includes dust, smoke, sea salt and other aerosols; it is not a mineral dust mass concentration.'],
    ['Mapped lithology', land.lithology || 'Unavailable', land.source?.name || 'Macrostrat'],
    ['Mapped geology unit', land.lithologyName || 'Unavailable', 'Macrostrat map unit at the screening coordinate'],
    ['Mapped geologic age', land.geologicAge || (Number.isFinite(land.geologicAgeMa) ? `${land.geologicAgeMa} Ma` : 'Unavailable'), 'Macrostrat map-unit age; mapped unit scale is heterogeneous'],
    ['Soil texture observations', land.soilTexture ? JSON.stringify(land.soilTexture) : 'Unavailable', 'ISRIC SoilGrids; values as returned by source'],
    ['Local relief', site.v?.terrain ? `${site.v.terrain.value} ±${site.v.terrain.uncertainty} index` : 'Unavailable', site.v?.terrain?.source?.name || 'OpenTopoData / SRTM'],
    ['Data retrieval time', climate.retrievedAt || 'Snapshot time not recorded', source]
  ];
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  for (const [key, label, unit] of [
    ['ts', 'Monthly surface temperature', '°C'],
    ['precipMmDay', 'Monthly precipitation', 'mm/day'],
    ['rh2m', 'Monthly relative humidity', '%'],
    ['solarKwh', 'Monthly surface solar', 'kWh/m²/day'],
    ['aod55', 'Monthly aerosol optical depth AOD_55', 'dimensionless']
  ]) {
    const values = climate.monthly?.[key];
    if (Array.isArray(values) && values.length === 12) {
      rows.push([label, values.map((value, index) => `${monthNames[index]} ${value}`).join('; ') + ` ${unit}`, `${source} · ${period}`]);
    }
  }
  for (const [dataset, error] of Object.entries(ctx.validationErrors || {})) {
    rows.push([`${dataset} dataset status`, `Unavailable: ${error}`, dataset]);
  }
  return rows;
}

function targetRows(target) {
  const values = target.measurements?.values || target.v || {};
  const rows = factorLabels.map(([key, label]) => {
    const item = values[key];
    if (!item || !Number.isFinite(item.value)) return [label, 'Unavailable', 'No valid measurement for this factor'];
    const unit = item.unit || (key === 'temp' ? '°C' : key === 'solar' ? 'kWh/m²/day' : 'index');
    const source = item.source?.name || item.source?.id || target.measurements?.dataset || 'Source not recorded';
    const period = item.source?.period || item.source?.resolution || '';
    return [label, `${item.value} ${unit}${Number.isFinite(item.uncertainty) ? ` ±${item.uncertainty}` : ''}`, `${source} · period: ${period || 'not specified in profile source metadata'}${item.note ? ` · ${item.note}` : ''}`];
  });
  const pressure = values.pressureKpa;
  if (pressure && Number.isFinite(pressure.value)) {
    rows.push(['Surface pressure', `${pressure.value} kPa${Number.isFinite(pressure.uncertainty) ? ` ±${pressure.uncertainty}` : ''}`, `${pressure.source?.name || 'Mars Climate Database'}${pressure.note ? ` · ${pressure.note}` : ''}`]);
  } else if (target.body === 'moon') {
    rows.push(['Atmosphere / pressure', 'Near-vacuum; this probe does not report a numeric pressure value', 'Lunar vacuum reference; no Earth atmospheric-pressure analogue']);
  }
  if (target.measurements?.retrievedAt) rows.push(['Point-probe retrieved', target.measurements.retrievedAt, target.measurements.dataset || 'Current probe execution']);
  return rows;
}

function targetName(target) { return `${target.name} (${target.body}) · ${target.lat}, ${target.lon}`; }
function earthName(site) { return `${site.name || 'Earth grid cell'} · ${site.lat}, ${site.lon} (WGS84)`; }

export function siteDetailHtml(target, earth, selected = 'earth', result = null) {
  const isEarth = selected === 'earth';
  const title = isEarth ? 'Detailed Earth site report' : `Planetary target report · ${target.name}`;
  const location = isEarth ? earthName(earth) : targetName(target);
  const rows = isEarth ? earthRows(earth) : targetRows(target);
  const notes = isEarth ? (earth.limitations || []) : (target.measurements?.warnings || []);
  const score = result ? `<p class="report-score">Current comparison: ${Math.round(result.total)}% · ${escapeHtml(result.status)} · coverage ${Math.round(result.coverage * 100)}% · confidence ${Math.round(result.confidence)}% · uncertainty ${escapeHtml(result.scoreInterval?.join('–') || 'unavailable')}%</p>` : '';
  return `<dialog class="site-report-dialog"><form method="dialog"><button class="dialog-close">Close</button></form><h2>${escapeHtml(title)}</h2><p>${escapeHtml(location)}</p>${score}${table(rows)}${notes.length ? `<h3>Limitations / data notes</h3><ul>${notes.map((note) => `<li>${escapeHtml(note)}</li>`).join('')}</ul>` : ''}</dialog>`;
}

export function researchPaperHtml(target, earth, result) {
  const planetImage = pointImage(target.body, target.lat, target.lon);
  const earthImage = pointImage('earth', earth.lat, earth.lon, state.earthImageDate, state.earthImageSatellite || 'Terra');
  const planetImageMarkup = `<img src="${escapeHtml(planetImage.url)}" data-fallback="${escapeHtml(planetImage.fallback || '')}" data-fallbacks="${escapeHtml(JSON.stringify(planetImage.fallbacks || []))}" alt="${escapeHtml(planetImage.source)}">`;
  const captureAssessment = state.earthImageAssessment;
  const parameters = result.parts.map((part) => [
    part.f.label,
    Number.isFinite(part.t) ? `${part.t} ${part.f.unit}` : 'Unavailable',
    Number.isFinite(part.a) ? `${part.a} ${part.f.unit}` : 'Unavailable',
    part.valid ? `${part.sim}% (weight ${part.wt})` : `Excluded: ${part.reason || 'missing / incompatible data'}`
  ]);
  const rows = earthRows(earth);
  const sourceList = [
    ...(earth.provenance || []).map((entry) => entry.source).filter(Boolean),
    ...(target.measurements?.sources || []),
    ...Object.values(target.v || {}).map((item) => item?.source).filter(Boolean)
  ];
  const sources = [...new Map(sourceList.map((source) => [source.url || source.id, source])).values()]
    .map((source) => `<li>${escapeHtml(source.name || source.id)}${source.period ? ` · ${escapeHtml(source.period)}` : ''}${source.url ? ` · <a href="${escapeHtml(source.url)}">${escapeHtml(source.url)}</a>` : ''}</li>`).join('');
  const nonrep = (result.nonReplicable || []).map((item) => typeof item === 'string' ? item : item.label || item.name || '').filter(Boolean).join('; ');
  return `<!doctype html><html><head><meta charset="utf-8"><title>ASTRA · Research paper · ${escapeHtml(target.name)}</title><style>
    body{font:11pt Georgia,serif;color:#111;max-width:900px;margin:28px auto;line-height:1.5}h1,h2{font-family:Arial,sans-serif}h1{font-size:20pt}h2{font-size:15pt;margin:24px 0 8px}.muted{color:#444}.score{font:bold 18pt Arial}.images{display:grid;grid-template-columns:1fr 1fr;gap:16px}.images img{width:100%;height:250px;object-fit:cover}.images figure{margin:0}.images figcaption{font:9pt Arial;color:#444}table{width:100%;border-collapse:collapse;font:9pt Arial}td,th{border:1px solid #777;padding:5px;text-align:left;vertical-align:top}thead{background:#eee}.note{border-left:3px solid #555;padding:8px 12px;background:#f5f5f5}@media print{body{margin:0;max-width:none}figure,.note{break-inside:avoid}h2{break-after:avoid}tr{break-inside:avoid}a{color:#111;text-decoration:none}}
    </style></head><body><header><p>ASTRA · Planetary Analog Discovery</p><h1>Evidence-based planetary analog comparison</h1><p class="muted">Generated ${escapeHtml(new Date().toISOString())} · Engine ${escapeHtml(result.engineVersion)} · Configuration ${escapeHtml(result.configVersion)}</p></header>
    <section><h2>Abstract</h2><p>Comparison of ${escapeHtml(targetName(target))} with the highest-scoring eligible Earth grid cell in the current research dataset. The score uses active weights and validated comparable features only; it does not establish planetary equivalence or mission suitability.</p><p class="score">Similarity ${Math.round(result.total)}% · ${escapeHtml(result.status)} · coverage ${Math.round(result.coverage * 100)}% · confidence ${Math.round(result.confidence)}% · 95% interval ${escapeHtml(result.scoreInterval?.join('–') || 'unavailable')}%</p></section>
    <section><h2>Locations and original imagery</h2><p><b>Planetary target:</b> ${escapeHtml(targetName(target))}<br><b>Earth candidate:</b> ${escapeHtml(earthName(earth))}</p><div class="images"><figure>${planetImageMarkup}<figcaption>${escapeHtml(planetImage.source)} · ${escapeHtml(planetImage.citation)}</figcaption></figure><figure>${earthImage.url ? `<img src="${escapeHtml(earthImage.url)}">` : `<p>No dated Earth satellite capture was selected. Choose a date or find the clearest capture in Compare before exporting.</p>`}<figcaption>${escapeHtml(earthImage.source)} · ${escapeHtml(earthImage.citation)}${captureAssessment ? ` · ${captureAssessment.date} ${captureAssessment.satellite}, ${Math.round(captureAssessment.coveragePercent)}% observed-window coverage; ${Math.round(captureAssessment.clearPixelPercent)}% of observed pixels screened into lower cloud-fraction classes. ${escapeHtml(captureAssessment.note)}` : ''}</figcaption></figure></div></section>
    <section><h2>Methods</h2><p>Similarity is 100 × (1 − weighted mean bounded distance). Missing, invalid, or incompatible factors are excluded and identified below. The Earth screening cell is ${earth.cellDegrees ? `${escapeHtml(earth.cellDegrees)}°` : 'a live point'} wide; its label is supplied by reverse geocoding and does not affect the score. AOD_55 is reported as context only because an equivalent validated planetary aerosol optical-depth product is not part of this comparison. It is not a mineral-dust mass concentration.</p></section>
    <section><h2>Parameter-wise comparison</h2>${table(parameters, ['Parameter', 'Planetary target', 'Earth site', 'Similarity / status'])}</section>
    <section><h2>Earth site: climate, atmosphere, land and dust</h2>${table(rows)}</section>
    <section><h2>Planetary measurements</h2>${table(targetRows(target))}</section>
    <section><h2>Limitations</h2><div class="note">${escapeHtml((earth.limitations || []).join(' '))} ${escapeHtml(nonrep)} Dust is labeled unavailable when no validated measurement exists.</div></section>
    <section><h2>References</h2><ul>${sources || '<li>Source references were not recorded in the current data payload.</li>'}</ul></section><footer><p class="muted">Screening-grid resolution and differing sensor footprints limit local representativeness.</p></footer>
    <script>document.querySelectorAll('img[data-fallbacks]').forEach(i=>i.addEventListener('error',()=>{let f=[];try{f=JSON.parse(i.dataset.fallbacks||'[]')}catch{}if(!f.length&&i.dataset.fallback)f=[i.dataset.fallback];const n=Number(i.dataset.fallbackIndex||0);if(n<f.length){i.dataset.fallbackIndex=String(n+1);i.src=f[n]}else{i.remove()}}));addEventListener('load',()=>Promise.all([...document.images].map(i=>i.complete?Promise.resolve():new Promise(r=>{i.onload=i.onerror=r}))).then(()=>setTimeout(()=>print(),300)));</script></body></html>`;
}
