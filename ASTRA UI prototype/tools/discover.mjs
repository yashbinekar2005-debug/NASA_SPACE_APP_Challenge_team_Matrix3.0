import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadEnv, env, contact } from './lib/env.mjs';
import { buildLandGrid, coordId } from './lib/grid.mjs';
import { fetchPower, powerUrl } from './lib/sources/power.mjs';
import { fetchSoilGrids } from './lib/sources/soilgrids.mjs';
import { fetchRelief } from './lib/sources/topo.mjs';
import { fetchGeology } from './lib/sources/macrostrat.mjs';
import { reverseGeocode } from './lib/sources/geocode.mjs';
import { fetchCaveEntrances } from './lib/sources/overpass.mjs';
import {
  dryness,
  iceEvidence,
  lavaTubeCapability,
  screenFeatures,
  soilComposition,
  solarIllumination,
  surfaceTemperature,
  terrainRoughness
} from './lib/features.mjs';
import { mapLimit, cacheStats, fetchCached } from './lib/http.mjs';

import { TARGETS } from '../js/data/targets.js';
import { PRESETS } from '../js/data/presets.js';
import { score, rankAnalogs, ENGINE_VERSION, CONFIG_VERSION } from '../js/core/scoring.js';

/**
 * Discovery pipeline.
 *
 *   Stage 1  global land grid -> NASA POWER climate screening
 *   Stage 2  validate shortlisted cells against SRTM, SoilGrids, Macrostrat,
 *            OSM cave entrances and a reverse geocoder
 *   Stage 3  write a provenance-rich snapshot; the UI ranks it with the same
 *            engine used everywhere else
 *
 * Nothing in this file is a predefined analog site. Site names come from a
 * reverse geocoder; all feature values come from the datasets named in
 * `provenance`.
 */

const HERE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
loadEnv(HERE);

const args = parseArgs(process.argv.slice(2));
const GRID_DEG = numberArg(args.grid, 6);
const SHORTLIST_PER_TARGET = numberArg(args.shortlist, 40);
const MAX_CANDIDATES = numberArg(args.max, 110);
const REFRESH = Boolean(args.refresh);
const NO_CAVES = Boolean(args['no-caves']);
const TARGET_FILTER = args.targets ? String(args.targets).split(',') : null;
const CELL_LIMIT = numberArg(args['limit-cells'], 0);

const TARGET_SET = TARGETS.filter((target) => !TARGET_FILTER || TARGET_FILTER.includes(target.id));
if (!TARGET_SET.length) throw new Error('No targets selected.');

console.log(`ASTRA discovery · grid ${GRID_DEG}° · shortlist ${SHORTLIST_PER_TARGET}/target · max ${MAX_CANDIDATES}`);
console.log(`Contact: ${contact()}`);
console.log('');

/* ------------------------------------------------------------------ */
/* Stage 1 — global grid and climate screening                         */
/* ------------------------------------------------------------------ */

const cells = await buildLandGrid(GRID_DEG);
const screeningCells = CELL_LIMIT > 0 ? cells.slice(0, CELL_LIMIT) : cells;
console.log(`Land grid: ${cells.length} cells; screening ${screeningCells.length}.`);

let done = 0;
const screened = await mapLimit(screeningCells, 5, async (cell) => {
  try {
    const power = await fetchPower(cell.lat, cell.lon, { refresh: REFRESH });
    done += 1;
    if (done % 25 === 0) console.log(`  climate ${done}/${screeningCells.length}`);
    if (!power) return null;
    const v = screenFeatures(power);
    if (!v?.temp || !v?.solar || !v?.dry) return null;
    return { cell, power, v };
  } catch (error) {
    done += 1;
    console.warn(`  climate failed at ${cell.lat},${cell.lon}: ${shortError(error)}`);
    return null;
  }
});

const usable = screened.filter((entry) => entry && !entry.__error);
console.log(`Climate data: ${usable.length}/${screeningCells.length} cells.\n`);

if (!usable.length) {
  throw new Error('No cells returned usable climate data. Check network / cache and retry.');
}

/* ------------------------------------------------------------------ */
/* Stage 2 — shortlist per target, then validate                       */
/* ------------------------------------------------------------------ */

const weights = PRESETS[0].w;
const shortlist = new Map();

for (const target of TARGET_SET) {
  const scored = usable
    .map((entry) => ({
      entry,
      result: score(target, { id: entry.cell.id, name: entry.cell.id, conf: 'Low', v: entry.v }, weights)
    }))
    .filter(({ result }) => result.status === 'ok' || result.total > 0);

  scored.sort((a, b) => b.result.total - a.result.total);
  const chosen = new Map();
  scored.slice(0, SHORTLIST_PER_TARGET).forEach(({ entry, result }) => {
    chosen.set(entry.cell.id, { entry, targetId: target.id, reason: 'overall', screen: result.total });
  });

  // Ensure each individual feature gets a voice in the shortlist. A cell that
  // is the best thermal match should not be dropped only because the overall
  // provisional score is lower.
  for (const partKey of ['temp', 'solar', 'ice', 'dry']) {
    scored
      .map(({ entry, result }) => ({
        entry,
        result,
        part: result.parts.find((part) => part.f.k === partKey)
      }))
      .filter(({ part }) => part?.valid)
      .sort((a, b) => b.part.sim - a.part.sim)
      .slice(0, 6)
      .forEach(({ entry, result }) => {
        if (!chosen.has(entry.cell.id)) {
          chosen.set(entry.cell.id, {
            entry,
            targetId: target.id,
            reason: partKey,
            screen: result.total
          });
        }
      });
  }

  console.log(`  ${target.name}: shortlisted ${chosen.size} cells; best provisional ${Math.round(scored[0]?.result.total ?? 0)}%`);
  for (const item of chosen.values()) {
    if (!shortlist.has(item.entry.cell.id)) {
      shortlist.set(item.entry.cell.id, { ...item, targets: new Set([target.id]) });
    } else {
      shortlist.get(item.entry.cell.id).targets.add(target.id);
    }
  }
}

let candidates = [...shortlist.values()];
if (candidates.length > MAX_CANDIDATES) {
  candidates.sort((a, b) => b.screen - a.screen);
  candidates = candidates.slice(0, MAX_CANDIDATES);
  console.log(`\nCapped enriched candidates to ${candidates.length} (max ${MAX_CANDIDATES}).`);
}

// Cells that matter for a tube target get an OSM cave query. This is kept
// separate so a busy Overpass mirror cannot slow the whole run.
const caveCells = new Set();
if (!NO_CAVES) {
  for (const target of TARGET_SET.filter((entry) => entry.v.tube?.value >= 50)) {
    usable
      .map((entry) => ({
        entry,
        result: score(target, { id: entry.cell.id, name: entry.cell.id, conf: 'Low', v: entry.v }, weights)
      }))
      .sort((a, b) => b.result.total - a.result.total)
      .slice(0, Math.min(18, SHORTLIST_PER_TARGET))
      .forEach(({ entry }) => caveCells.add(entry.cell.id));
  }
}

console.log(`\nValidating ${candidates.length} shortlisted cells${caveCells.size ? ` (${caveCells.size} with cave checks)` : ''}…`);

let enrichedCount = 0;
const enriched = await mapLimit(candidates, 4, async (item) => {
  const { cell, power } = item.entry;
  const [relief, soil, geology, geocode] = await Promise.all([
    fetchRelief(cell.lat, cell.lon, { refresh: REFRESH }).catch(() => null),
    fetchSoilGrids(cell.lat, cell.lon, { refresh: REFRESH }).catch(() => null),
    fetchGeology(cell.lat, cell.lon, { refresh: REFRESH }).catch(() => null),
    reverseGeocode(cell.lat, cell.lon, { refresh: REFRESH }).catch(() => null)
  ]);

  let caves = null;
  if (caveCells.has(cell.id)) {
    caves = await fetchCaveEntrances(cell.lat, cell.lon, { refresh: REFRESH });
  }

  enrichedCount += 1;
  if (enrichedCount % 10 === 0) console.log(`  validation ${enrichedCount}/${candidates.length}`);

  return buildCandidate({
    cell,
    power,
    relief,
    soil,
    geology,
    geocode,
    caves,
    targets: item.targets,
    screenScore: item.screen
  });
});

const built = enriched.filter((candidate) => candidate && !candidate.__error);

/* ------------------------------------------------------------------ */
/* Stage 3 — snapshot                                                  */
/* ------------------------------------------------------------------ */

const snapshot = {
  schema: 'astra.discovery/1',
  generatedAt: new Date().toISOString(),
  engineVersion: ENGINE_VERSION,
  configVersion: CONFIG_VERSION,
  generator: 'tools/discover.mjs',
  grid: {
    stepDegrees: GRID_DEG,
    landCellsBuilt: cells.length,
    cellsScreened: screeningCells.length,
    cellsWithClimate: usable.length,
    shortlisted: candidates.length,
    validated: built.length
  },
  shortlist: {
    perTarget: SHORTLIST_PER_TARGET,
    maxCandidates: MAX_CANDIDATES,
    targets: TARGET_SET.map((target) => target.id)
  },
  sources: sourceRegistry(),
  candidates: built.sort(compareCandidates)
};

const check = validateSnapshot(snapshot);
if (!check.ok) {
  throw new Error(`Snapshot validation failed: ${check.errors.join('; ')}`);
}

const outFile = path.resolve(HERE, env('ASTRA_DISCOVERY_OUT', 'js/data/discovered.js'));
await fs.mkdir(path.dirname(outFile), { recursive: true });
const json = JSON.stringify(snapshot, null, 2);
await fs.writeFile(outFile, generatedModule(snapshot), 'utf8');

const jsonFile = path.resolve(HERE, 'data', 'discovered.json');
await fs.mkdir(path.dirname(jsonFile), { recursive: true });
await fs.writeFile(jsonFile, json, 'utf8');

console.log('');
console.log(`Wrote ${path.relative(HERE, outFile)} (${built.length} candidates)`);
console.log(`Wrote ${path.relative(HERE, jsonFile)}`);
console.log(`Cache: ${JSON.stringify(cacheStats())}`);

/* ------------------------------------------------------------------ */
/* Candidate builder                                                   */
/* ------------------------------------------------------------------ */

function buildCandidate({ cell, power, relief, soil, geology, geocode, caves, targets, screenScore }) {
  const temp = surfaceTemperature(power);
  const solar = solarIllumination(power);
  const dry = dryness(power);
  const ice = iceEvidence(power);
  const terrain = terrainRoughness(relief);
  const soilFeature = soilComposition(soil, geology);
  const tube = lavaTubeCapability(geology, caves);

  const v = { temp, solar, ice, soil: soilFeature, terrain, dry, tube };
  const available = Object.values(v).filter(Boolean).length;
  if (!temp || !solar || !dry || available < 4) return null;

  const provenance = [];
  for (const [key, measurement] of Object.entries(v)) {
    if (!measurement) continue;
    provenance.push({
      key,
      source: measurement.source,
      value: measurement.value,
      unit: measurement.unit || null,
      uncertainty: measurement.uncertainty,
      evidence_class: measurement.evidenceClass ?? null,
      note: measurement.source?.note || null
    });
  }

  const srcCount = ['power', 'relief', 'soil', 'geology', 'geocode', 'caves']
    .filter((key) => ({ power, relief, soil, geology, geocode, caves })[key]).length;
  const conf = srcCount >= 5 && soilFeature && terrain ? 'High'
    : srcCount >= 3 ? 'Medium' : 'Low';

  const label = geocode?.locality || geocode?.subdivision || geocode?.country || 'Unnamed cell';
  // `region` is a locator label only. Coordinates are stored separately in
  // `lat`/`lon` and formatted by the UI, so they are not repeated here.
  const regionParts = [geocode?.country].filter(Boolean);
  const terrainSeed = hashSeed(cell.id);

  const limitations = [];
  limitations.push(
    `Screening cell is ${GRID_DEG}° wide; local microclimate and terrain can differ from the cell centre.`
  );
  if (!relief) limitations.push('SRTM relief unavailable; terrain feature is missing.');
  if (!soil) limitations.push('SoilGrids texture unavailable; soil proxy falls back to mapped geology.');
  if (!geology) limitations.push('No mapped bedrock unit at this point; soil proxy falls back to texture.');
  if (!caves) limitations.push('No OSM cave query was run for this cell; tube capability is a geology-only proxy.');
  else if (!caves.available) limitations.push('OSM cave query failed; tube capability is a geology-only proxy for this cell.');
  else if (caves.count === 0) limitations.push('No mapped cave entrance within 25 km; this is not proof that no cave exists.');
  limitations.push('Earth gravity, vacuum, radiation and magnetic field are not reproduced anywhere on Earth.');

  return {
    id: `earth-${coordId(cell.lat, cell.lon)}`,
    name: label,
    region: regionParts.join(' · '),
    lat: cell.lat,
    lon: cell.lon,
    cellDegrees: GRID_DEG,
    discovered: true,
    conf,
    tags: [
      conf === 'High' ? 'Validated cell' : 'Screening cell',
      ...(geology?.primary?.lith ? [shortLith(geology.primary.lith)] : []),
      ...(caves?.available && caves.count > 0 ? ['Mapped cave entrance'] : [])
    ],
    v,
    soilDesc: soilFeature?.source?.note || 'Soil proxy from mapped geology and texture',
    terrainDesc: terrain?.source?.note || 'Terrain proxy unavailable',
    summary: buildSummary({ v, geology, caves }),
    limitations,
    provenance,
    sourceIds: [...new Set(provenance.map((entry) => entry.source?.id).filter(Boolean))],
    screen: {
      provisional_score: Number.isFinite(screenScore) ? Math.round(screenScore) : null,
      provisional_scope: 'climate-only screening before terrain, soil and geology validation',
      selected_for_targets: [...targets],
      reason: 'climate screening + per-feature coverage'
    },
    tp: {
      seed: terrainSeed,
      rough: clamp((terrain?.value ?? 30) / 100, 0.15, 0.9),
      crater: clamp(0.15 + (soilFeature?.value ?? 0) / 400, 0.15, 0.55),
      pit: caves?.available ? 1.1 : 0,
      ripple: clamp((soilFeature?.sandFraction ?? 0.4) * 0.7, 0.2, 0.7)
    }
  };
}

function buildSummary({ v, geology, caves }) {
  const bits = [];
  if (v.temp) bits.push(`${v.temp.value} °C mean surface`);
  if (v.solar) bits.push(`${v.solar.value} kWh/m²/day solar`);
  if (v.ice) bits.push(`water evidence class ${v.ice.evidenceClass}/3`);
  if (v.soil) bits.push(`soil proxy ${v.soil.value}/100`);
  if (v.terrain) bits.push(`relief proxy ${v.terrain.value}/100`);
  if (v.tube && v.tube.value > 20) bits.push(`cave access ${v.tube.value}/100`);
  const geologyText = geology?.primary?.lith ? `Mapped geology: ${geology.primary.lith}.` : '';
  const caveText = caves?.available ? `${caves.count} mapped cave entrance(s) within 25 km.` : '';
  return `${bits.join('; ')}. ${geologyText} ${caveText}`.trim();
}

function shortLith(lith) {
  return String(lith).split(';')[0].slice(0, 28);
}

function compareCandidates(a, b) {
  if (a.conf !== b.conf) {
    const rank = { High: 3, Medium: 2, Low: 1 };
    return (rank[b.conf] || 0) - (rank[a.conf] || 0);
  }
  return a.id.localeCompare(b.id);
}

function hashSeed(text) {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) % 997;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

/* ------------------------------------------------------------------ */
/* Output helpers                                                      */
/* ------------------------------------------------------------------ */

function generatedModule(snapshot) {
  return [
    '/*',
    ' * GENERATED FILE — do not edit by hand.',
    ' * Produced by: node tools/discover.mjs',
    ` * Generated: ${snapshot.generatedAt}`,
    ` * Grid: ${snapshot.grid.stepDegrees}° · candidates: ${snapshot.candidates.length}`,
    ' *',
    ' * Every candidate below was discovered from the datasets listed in',
    ' * `sources`; no site list is hard-coded in the application.',
    ' */',
    `export const DISCOVERY = ${JSON.stringify(snapshot, null, 2)};`,
    'export const ANALOGS = DISCOVERY.candidates;',
    ''
  ].join('\n');
}

function sourceRegistry() {
  return [
    {
      id: 'nasa-power',
      name: 'NASA POWER / MERRA-2 monthly climatology',
      url: 'https://power.larc.nasa.gov/',
      role: 'temperature, solar irradiance, precipitation, humidity, snow, soil wetness, frost days',
      auth: 'None (public)',
      period: '2001-2025'
    },
    {
      id: 'soilgrids',
      name: 'ISRIC SoilGrids 2.0',
      url: 'https://soilgrids.org/',
      role: '0–5 cm clay/sand/silt, organic carbon, bulk density, coarse fragments',
      auth: 'None (public)',
      resolution: '250 m'
    },
    {
      id: 'opentopodata-srtm90m',
      name: 'OpenTopoData / NASA SRTM 90 m',
      url: 'https://www.opentopodata.org/',
      role: '3×3 local relief sample',
      auth: 'Optional key for higher limits',
      resolution: '90 m'
    },
    {
      id: 'macrostrat',
      name: 'Macrostrat geologic map',
      url: 'https://macrostrat.org/',
      role: 'mapped lithology and age',
      auth: 'None (public, CC-BY 4.0)'
    },
    {
      id: 'osm-overpass',
      name: 'OpenStreetMap cave entrances via Overpass',
      url: 'https://www.openstreetmap.org/',
      role: 'mapped cave/tube access capability',
      auth: 'None (public, ODbL 1.0)'
    },
    {
      id: 'bigdatacloud',
      name: 'BigDataCloud reverse geocode',
      url: 'https://www.bigdatacloud.com/',
      role: 'human-readable place labels only; never used in scoring',
      auth: 'None (public client endpoint)'
    }
  ];
}

function validateSnapshot(snapshot) {
  const errors = [];
  if (!snapshot.candidates.length) errors.push('no candidates');
  const ids = new Set();
  for (const candidate of snapshot.candidates) {
    if (ids.has(candidate.id)) errors.push(`duplicate id ${candidate.id}`);
    ids.add(candidate.id);
    if (!candidate.v?.temp || !candidate.v?.solar || !candidate.v?.dry) {
      errors.push(`${candidate.id} missing required climate features`);
    }
    for (const key of ['temp', 'solar', 'ice', 'soil', 'terrain', 'dry', 'tube']) {
      const value = candidate.v[key]?.value;
      if (value != null && !Number.isFinite(Number(value))) {
        errors.push(`${candidate.id} ${key} is not finite`);
      }
    }
  }
  return { ok: !errors.length, errors };
}

function parseArgs(argv) {
  const out = {};
  for (const arg of argv) {
    if (!arg.startsWith('--')) continue;
    const [key, value] = arg.slice(2).split('=');
    out[key] = value == null ? true : value;
  }
  return out;
}

function numberArg(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function shortError(error) {
  return String(error?.message || error).slice(0, 120);
}
