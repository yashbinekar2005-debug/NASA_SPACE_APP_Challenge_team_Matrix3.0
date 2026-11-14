import { monthlySpread } from './sources/power.mjs';
import { sandFraction } from './sources/soilgrids.mjs';

/**
 * Transparent feature derivation.
 *
 * Every transformation below is a documented, deterministic function of a
 * measured quantity. None of these functions contains a site name, a
 * pre-computed score, or a random value. Where the science is indirect (soil
 * composition, cave access) the feature is labelled a proxy and given a larger
 * uncertainty.
 */

export const FORMULAS = Object.freeze({
  temp: 'Annual mean MERRA-2/POWER Earth skin temperature (TS), °C.',
  solar: 'Annual mean surface shortwave downward irradiance (ALLSKY_SFC_SW_DWN), kWh/m²/day.',
  dry: '100 × [0.7 × (1 − min(1, P_annual/1000 mm)) + 0.3 × (1 − RH/100)], P from PRECTOTCORR, RH from RH2M.',
  ice: 'Evidence class from annual snow depth, frost days and root-zone wetness; index = 100 × [0.55·min(1, snow/30 cm) + 0.25·min(1, frost/200 d) + 0.20·min(1, wetness/0.4)].',
  soil: '0.7 × lithology-derived mafic/volcanic score + 0.3 × sand fraction of fine earth. Macrostrat lithology + SoilGrids 0–5 cm texture.',
  terrain: '100 × min(1, local relief / 1000 m), relief = max − min of a 3×3 SRTM 90 m sample ~9 km apart.',
  tube: 'max(OSM cave-entrance score, 0.5 × geology capability). OSM score = 100 × (1 − exp(−N/2)) for N mapped entrances within 25 km.'
});

export const ICE_CLASS_LABELS = Object.freeze({
  0: 'No surface water/ice evidence in the selected datasets',
  1: 'Moist ground or seasonal water present',
  2: 'Seasonal snow or frequent frost',
  3: 'Persistent snow, ice or permafrost signature'
});

function measurement(value, uncertainty, source, extra = {}) {
  if (!Number.isFinite(value)) return null;
  return {
    value: round(value, 2),
    uncertainty: Number.isFinite(uncertainty) ? round(uncertainty, 2) : null,
    source,
    ...extra
  };
}

export function screenFeatures(power) {
  if (!power) return null;
  const annual = power.annual;
  const temp = surfaceTemperature(power);
  const solar = solarIllumination(power);
  const dry = dryness(power);
  const ice = iceEvidence(power);
  return {
    temp,
    solar,
    ice,
    dry,
    soil: null,
    terrain: null,
    tube: null
  };
}

export function surfaceTemperature(power) {
  if (!power) return null;
  const value = power.annual.ts ?? power.annual.t2m;
  if (!Number.isFinite(value)) return null;
  const spread = monthlySpread(power.monthly.ts);
  const uncertainty = Math.max(0.8, (spread ?? 1) * 0.25);
  return measurement(value, uncertainty, {
    id: 'nasa-power-ts',
    name: 'NASA POWER MERRA-2 Earth skin temperature',
    url: power.url,
    period: '2001-2025',
    note: spread == null ? 'Annual mean.' : `Annual mean; monthly spread ${spread.toFixed(1)} °C.`
  }, { measurementType: 'annual_mean_surface_temperature', unit: '°C' });
}

export function solarIllumination(power) {
  if (!power) return null;
  const value = power.annual.solarKwh;
  if (!Number.isFinite(value)) return null;
  const spread = monthlySpread(power.monthly.solarKwh);
  const uncertainty = Math.max(0.2, (spread ?? 0.3) * 0.25);
  return measurement(value, uncertainty, {
    id: 'nasa-power-solar',
    name: 'NASA POWER all-sky surface shortwave irradiance',
    url: power.url,
    period: '2001-2025',
    note: 'Annual mean of monthly means.'
  }, { measurementType: 'annual_mean_surface_shortwave', unit: 'kWh/m²/day' });
}

export function dryness(power) {
  if (!power) return null;
  const precipMmDay = power.annual.precipMmDay;
  const rh = power.annual.rh2m;
  if (!Number.isFinite(precipMmDay) || !Number.isFinite(rh)) return null;
  const precipMmYear = precipMmDay * 365;
  const precipTerm = 1 - clamp(precipMmYear / 1000, 0, 1);
  const rhTerm = 1 - clamp(rh / 100, 0, 1);
  const value = 100 * (0.7 * precipTerm + 0.3 * rhTerm);
  return measurement(value, 6, {
    id: 'nasa-power-dryness',
    name: 'NASA POWER precipitation + relative humidity',
    url: power.url,
    period: '2001-2025',
    note: `P = ${precipMmYear.toFixed(0)} mm/yr; RH = ${rh.toFixed(0)} %.`
  }, { measurementType: 'aridity_proxy', unit: 'index' });
}

export function iceEvidence(power) {
  if (!power) return null;
  const snow = power.annual.snowDepthCm;
  const frost = power.annual.frostDays;
  const wet = power.annual.soilWetRoot ?? power.annual.soilWetProfile;
  const precip = power.annual.precipMmDay;
  if (![snow, frost, wet, precip].some((value) => Number.isFinite(value))) return null;

  const s = Number.isFinite(snow) ? snow : 0;
  const f = Number.isFinite(frost) ? frost : 0;
  const w = Number.isFinite(wet) ? wet : 0;
  const p = Number.isFinite(precip) ? precip : 0;

  let evidenceClass = 0;
  if (s >= 10 || f >= 180) evidenceClass = 3;
  else if (s >= 1 || f >= 60) evidenceClass = 2;
  else if (w >= 0.25 || p >= 1) evidenceClass = 1;

  const index = 100 * clamp(
    0.55 * Math.min(1, s / 30) +
    0.25 * Math.min(1, f / 200) +
    0.20 * Math.min(1, w / 0.4),
    0, 1
  );

  return measurement(index, 8, {
    id: 'nasa-power-water',
    name: 'NASA POWER snow depth, frost days and soil wetness',
    url: power.url,
    period: '2001-2025',
    note: `${ICE_CLASS_LABELS[evidenceClass]}. Snow ${s.toFixed(1)} cm, frost ${f.toFixed(0)} d/yr, root-zone wetness ${w.toFixed(2)}.`
  }, {
    measurementType: 'water_ice_evidence',
    unit: 'index',
    evidenceClass,
    evidenceClassUncertainty: 0.4
  });
}

export function terrainRoughness(relief) {
  if (!relief || !Number.isFinite(relief.reliefM)) return null;
  const value = 100 * clamp(relief.reliefM / 1000, 0, 1);
  return measurement(value, 10, {
    id: 'opentopodata-srtm90m',
    name: 'OpenTopoData / NASA SRTM 90 m',
    url: relief.url,
    note: `Local relief ${Math.round(relief.reliefM)} m over a ${relief.radiusKm} km 3×3 sample; σ ${Math.round(relief.stdDevM)} m.`
  }, { measurementType: 'local_relief_proxy', unit: 'index' });
}

export function soilComposition(soil, geology) {
  const sand = sandFraction(soil?.values);
  const geologyMatch = classifyLithology(geology);
  const textureScore = sand == null ? null : 100 * sand;

  let value = null;
  let uncertainty = 25;
  let note = '';

  if (geologyMatch && textureScore != null) {
    value = 0.7 * geologyMatch.score + 0.3 * textureScore;
    uncertainty = 14;
    note = `Geology: ${geologyMatch.label} (${geologyMatch.score}/100); sand fraction ${(100 * sand).toFixed(0)} %.`;
  } else if (geologyMatch) {
    value = geologyMatch.score;
    uncertainty = 22;
    note = `Geology only: ${geologyMatch.label}. SoilGrids texture unavailable.`;
  } else if (textureScore != null) {
    value = textureScore;
    uncertainty = 28;
    note = `Texture only: sand fraction ${(100 * sand).toFixed(0)} %. No mapped bedrock unit at this point.`;
  } else {
    return null;
  }

  return measurement(value, uncertainty, {
    id: 'soilgrids+macrostrat',
    name: 'ISRIC SoilGrids 2.0 + Macrostrat geology',
    url: 'https://soilgrids.org/',
    note
  }, {
    measurementType: 'mafic_soil_proxy',
    unit: 'index',
    geology: geologyMatch,
    sandFraction: sand
  });
}

export function lavaTubeCapability(geology, caves) {
  const geologyMatch = classifyLithology(geology);
  const geologyCapability = !geologyMatch
    ? null
    : geologyMatch.score >= 80
      ? 55
      : geologyMatch.score >= 60
        ? 42
        : geologyMatch.karst
          ? 45
          : 12;

  const osmScore = caves?.available && Number.isFinite(caves.count)
    ? 100 * (1 - Math.exp(-caves.count / 2))
    : null;

  let value = null;
  let note = '';
  if (osmScore != null && geologyCapability != null) {
    value = Math.max(osmScore, geologyCapability * 0.5);
    note = `${caves.count} mapped cave entrance(s) within ${Math.round(caves.radiusM / 1000)} km; geology capability ${geologyCapability}/100.`;
  } else if (osmScore != null) {
    value = osmScore;
    note = `${caves.count} mapped cave entrance(s) within ${Math.round(caves.radiusM / 1000)} km.`;
  } else if (geologyCapability != null) {
    value = geologyCapability * 0.5;
    note = `Geology-only proxy (${geologyMatch.label}); OSM cave query unavailable or not run.`;
  }
  if (value == null) return null;

  return measurement(value, 25, {
    id: 'osm+macrostrat-caves',
    name: 'OpenStreetMap cave entrances + Macrostrat geology',
    url: 'https://www.openstreetmap.org/',
    note: `${note} Capability proxy, not a surveyed tube.`
  }, {
    measurementType: 'cave_access_capability',
    unit: 'index',
    caveCount: caves?.available ? caves.count : null,
    osmAvailable: Boolean(caves?.available)
  });
}

/** Map a Macrostrat lithology string to a mafic/volcanic resemblance score. */
export function classifyLithology(geology) {
  if (!geology) return null;
  const units = geology.units?.length ? geology.units : [geology.primary].filter(Boolean);
  let best = null;

  for (const unit of units) {
    const text = `${unit.name || ''} ${unit.lith || ''} ${unit.description || ''}`.toLowerCase();
    const candidates = [
      [/\bbasalt\b|\bmafic\b|flood basalt|oceanic island basalt/, 95, 'basalt / mafic volcanic'],
      [/\bvolcan|\bandesit|\brhyolit|\bdacit|\btuff\b|\bignimbrit|\bpyroclast|\bkomatiit/, 82, 'volcanic rock'],
      [/\bgabbro|\bdolerit|\bdiabase|\bintrusive|\bgranit|\bigneous/, 65, 'igneous rock'],
      [/\bcarbonate|\blimestone|\bdolomit|\bkarst|\bmarble/, 45, 'carbonate / karst'],
      [/\bsandstone|\bshale|\bmudstone|\bsiltstone|\bconglomerate/, 30, 'clastic sedimentary'],
      [/\bunconsolidated|\balluvium|\bgravel|\bsand\b|\btill\b|\bglacial/, 35, 'unconsolidated cover']
    ];
    for (const [regex, score, label] of candidates) {
      if (regex.test(text) && (!best || score > best.score)) {
        best = {
          score,
          label,
          karst: /carbonate|limestone|dolomit|karst/.test(text),
          unit: unit.name || unit.lith || null,
          lith: unit.lith || null,
          age: unit.age || null
        };
      }
    }
  }
  return best;
}

export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function round(value, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
