import { env } from './env.mjs';
import { fetchCached, sleep } from './http.mjs';
import { parseMcdSeries, summarizeMcdSeries } from './sources/mcd.mjs';

/**
 * Point probes for the Moon and Mars.
 *
 * Every number returned by this module is traced to one of these original data
 * products or to an explicitly labelled geometric/model derivation:
 *
 *   Moon  NASA LRO LOLA DEM 256 ppd v06          (elevation, 9-point relief)
 *         LRO Diviner annual average hourly map  (surface temperature, 8 hours)
 *         Kaguya MI FeO weight-percent map       (mafic-soil proxy, ±50°)
 *         NASA Moon Fact Sheet                   (vacuum, solar constant)
 *
 *   Mars  NASA Mars Trek MOLA 128/64 ppd         (elevation, 9-point relief)
 *         USGS SIM3292 global geology            (mapped unit -> soil proxy)
 *         Mars Climate Database v6.2             (temperature, solar, H2O)
 *
 * `probeBody` never substitutes a made-up value for a failed request. Missing
 * products are returned as null and listed in `warnings`; the UI then excludes
 * them from the score and lowers coverage.
 */

const MOON_RADIUS_M = 1737400;
const MARS_RADIUS_M = 3389500;
const MCD_ENDPOINT = 'https://www-mars.lmd.jussieu.fr/mcd_python/cgi-bin/mcdcgi.py';
const TREK_MOON = 'https://trek.nasa.gov/moon/trekarcgis/rest/services';
const TREK_MARS = 'https://trek.nasa.gov/mars/trekarcgis/rest/services';

const LOCAL_HOURS = Object.freeze([0, 3, 6, 9, 12, 15, 18, 21]);

export const PROBE_SCHEMA = 'astra.planetary-probe/1';

const SOURCE = Object.freeze({
  lolaDem: {
    id: 'lro-lola-dem-256ppd',
    name: 'NASA LRO LOLA DEM Global 256 ppd v06',
    url: 'https://trek.nasa.gov/moon/',
    period: 'LRO mission product',
    resolution: '256 pixels per degree (~118 m at the equator)',
    evidenceType: 'remote_sensing'
  },
  diviner: {
    id: 'lro-diviner-hourly',
    name: 'LRO Diviner annual average surface temperature, hourly maps',
    url: 'https://www.diviner.ucla.edu/science',
    period: 'Annual average by local solar hour',
    resolution: 'Diviner polar/global mapped product',
    evidenceType: 'remote_sensing'
  },
  kaguyaFeo: {
    id: 'kaguya-mi-feo',
    name: 'Kaguya MI mineral deconvolution: FeO weight percent',
    url: 'https://trek.nasa.gov/moon/',
    period: 'Kaguya MI global mosaic, 50°N–50°S',
    resolution: 'Mapped 50°N–50°S product',
    evidenceType: 'remote_sensing_proxy'
  },
  moonSolar: {
    id: 'nasa-moon-solar-constant',
    name: 'NASA Moon Fact Sheet solar constant and geometric illumination',
    url: 'https://nssdc.gsfc.nasa.gov/planetary/factsheet/moonfact.html',
    period: 'Reference values',
    resolution: 'Point calculation from latitude',
    evidenceType: 'geometric_model'
  },
  moonVacuum: {
    id: 'nasa-moon-fact-sheet',
    name: 'NASA Moon Fact Sheet: negligible atmosphere',
    url: 'https://nssdc.gsfc.nasa.gov/planetary/factsheet/moonfact.html',
    period: 'Reference values',
    resolution: 'Global reference value',
    evidenceType: 'reference_value'
  },
  molaDem: {
    id: 'mars-mola-128-64',
    name: 'NASA Mars Trek MOLA 128/64 ppd merged DEM',
    url: 'https://trek.nasa.gov/mars/',
    period: 'MGS MOLA mission product',
    resolution: '128 pixels per degree at the equator / 64 at high latitude',
    evidenceType: 'remote_sensing'
  },
  marsGeology: {
    id: 'usgs-sim3292-geology',
    name: 'USGS SIM3292 global geologic map of Mars',
    url: 'https://trek.nasa.gov/mars/',
    period: 'Published global map',
    resolution: 'Global vector map units',
    evidenceType: 'mapped_geology'
  },
  mcd: {
    id: 'mars-climate-database-6.2',
    name: 'LMD/OU/IAA/ESA/CNES Mars Climate Database v6.2',
    url: 'https://www-mars.lmd.jussieu.fr/mars/access',
    period: 'Climatology, 25 seasonal samples; local time 12 h with diurnal averaging',
    resolution: 'Interpolated from the MCD spatial and seasonal model grid',
    evidenceType: 'modelled_climatology'
  }
});

/* ------------------------------------------------------------------ */
/* Pure, testable derivations                                          */
/* ------------------------------------------------------------------ */

/** Standard 0–100 relief index used by the Earth candidate pipeline. */
export function reliefIndex(elevations) {
  const finite = (elevations || []).filter(Number.isFinite);
  if (finite.length < 5) return null;
  const min = Math.min(...finite);
  const max = Math.max(...finite);
  const mean = finite.reduce((sum, value) => sum + value, 0) / finite.length;
  const variance = finite.reduce((sum, value) => sum + (value - mean) ** 2, 0) / finite.length;
  return {
    value: round(100 * clamp((max - min) / 1000, 0, 1), 2),
    reliefM: round(max - min, 1),
    stdDevM: round(Math.sqrt(variance), 1),
    minM: round(min, 1),
    maxM: round(max, 1),
    count: finite.length
  };
}

/**
 * Annual mean top-of-atmosphere irradiance on a level surface with no
 * atmosphere. 1361 W/m² is the NASA Moon Fact Sheet solar constant:
 *   1361 × 24 / π / 1000 = 10.398 kWh/m²/day at the equator.
 * This is a geometric estimate, not a measurement of local illumination.
 */
export function moonSolarEstimate(lat) {
  if (!Number.isFinite(lat)) return null;
  const value = 10.398 * Math.max(0, Math.cos(lat * Math.PI / 180));
  return {
    value: round(value, 3),
    uncertainty: round(Math.max(0.05, value * 0.25), 2),
    note: 'Geometric annual mean for a level surface using the NASA solar constant (1361 W/m²); local horizon, slopes and permanent shadow are not modelled.'
  };
}

/** Map Kaguya FeO weight percent to the shared 0–100 mafic-soil proxy. */
export function moonFeoProxy(feoWtPercent) {
  if (!Number.isFinite(feoWtPercent) || feoWtPercent < 0 || feoWtPercent > 40) return null;
  return {
    value: round(100 * clamp(feoWtPercent / 20, 0, 1), 1),
    uncertainty: 8,
    feoWtPercent,
    note: `Kaguya MI FeO ${feoWtPercent.toFixed(2)} wt%; mapped linearly from 0–20 wt% to the 0–100 mafic proxy. This is a composition proxy, not a soil-mechanics measurement.`
  };
}

/**
 * Map a USGS SIM3292 unit description to the same 0–100 geological proxy.
 * The mapping is deliberately broad because the map describes geologic units,
 * not measured basalt abundance.
 */
export function marsGeologyProxy(unit, description) {
  const text = `${unit || ''} ${description || ''}`.toLowerCase();
  if (!text.trim()) return null;
  const rules = [
    [/volcanic|basalt|mafic|edifice|shield|flow/, 92, 'volcanic / mafic unit'],
    [/transition|highland|noachian|crater|basin|plateau/, 55, 'highland or transition unit'],
    [/aqueous|clay|hydrated|sulfate|sedimentary|delta|lacustrine|lake|alluvial|fluvial/, 48, 'aqueous or sedimentary unit'],
    [/mantle|dust|sand|aeolian|dune/, 35, 'aeolian / mantle cover'],
    [/polar|ice|frost|cap/, 15, 'polar ice or frost unit'],
    [/plains/, 58, 'plains unit']
  ];
  for (const [pattern, value, label] of rules) {
    if (pattern.test(text)) {
      return {
        value,
        uncertainty: 25,
        label,
        unit: unit || null,
        description: description || null,
        note: `USGS SIM3292 unit ${unit || '(unnamed)'} — ${description || 'no description'}. Classified as "${label}" (${value}/100); this is a geologic-map proxy, not in-situ mineralogy.`
      };
    }
  }
  return {
    value: 45,
    uncertainty: 30,
    label: 'undifferentiated unit',
    unit: unit || null,
    description: description || null,
    note: `USGS SIM3292 unit ${unit || '(unnamed)'} — ${description || 'no description'}. No keyword match; assigned the neutral central proxy (45/100) rather than a fake high or low value.`
  };
}

/** Convert seasonal MCD surface H2O layer values to an ordered evidence class. */
export function marsIceEvidence(meanKg, maxKg) {
  if (!Number.isFinite(meanKg) || meanKg < 0) return null;
  const evidenceClass = meanKg >= 3 ? 3 : meanKg >= 0.5 ? 2 : meanKg >= 0.05 ? 1 : 0;
  return {
    value: round(100 * clamp(meanKg / 6, 0, 1), 1),
    uncertainty: 8,
    evidenceClass,
    evidenceClassUncertainty: 0.4,
    meanKg,
    maxKg: Number.isFinite(maxKg) ? maxKg : null,
    note: `MCD seasonal mean surface H2O layer ${meanKg.toFixed(3)} kg/m²${Number.isFinite(maxKg) ? ` (seasonal max ${maxKg.toFixed(3)})` : ''}. This is a model product, not a spectral ice detection.`
  };
}

/** Vapour-column aridity proxy, using the same 0–100 direction as Earth. */
export function marsDryness(vapourKgM2) {
  if (!Number.isFinite(vapourKgM2) || vapourKgM2 < 0) return null;
  return {
    value: round(100 * clamp(1 - vapourKgM2 / 0.2, 0, 1), 1),
    uncertainty: 5,
    vapourKgM2,
    note: `MCD annual mean water-vapour column ${vapourKgM2.toFixed(4)} kg/m²; index = 100 × (1 − min(1, column / 0.2 kg/m²)). It is an atmospheric proxy, not soil moisture.`
  };
}

/** Moon polar stereographic coordinates for Trek image services. */
export function polarXY(lat, lon, radius = MOON_RADIUS_M) {
  if (![lat, lon, radius].every(Number.isFinite)) return null;
  if (lat > 0) {
    const rho = 2 * radius * Math.tan((90 - lat) * Math.PI / 360);
    return {
      x: rho * Math.sin(lon * Math.PI / 180),
      y: -rho * Math.cos(lon * Math.PI / 180),
      wkid: 0
    };
  }
  const rho = 2 * radius * Math.tan((90 + lat) * Math.PI / 360);
  return {
    x: rho * Math.sin(lon * Math.PI / 180),
    y: rho * Math.cos(lon * Math.PI / 180),
    wkid: 0
  };
}

/** Find a named column in parsed MCD ASCII output. */
export function mcdColumn(series, pattern) {
  const name = Object.keys(series || {}).find((key) => pattern.test(key));
  return name ? series[name] : null;
}

/* ------------------------------------------------------------------ */
/* Source adapters                                                     */
/* ------------------------------------------------------------------ */

async function trekIdentify({ base, service, type = 'ImageServer', lat, lon, wkid, extra = {}, namespace, timeout = 20000 }) {
  const endpoint = `${base}/${service}/${type}/identify`;
  const params = {
    geometry: JSON.stringify({ x: lon, y: lat, spatialReference: { wkid } }),
    geometryType: 'esriGeometryPoint',
    sr: String(wkid),
    returnGeometry: 'false',
    f: 'json',
    ...extra
  };
  const url = `${endpoint}?${new URLSearchParams(params)}`;
  const response = await fetchCached(url, { namespace, timeout, retries: 2 });
  const body = response.body;

  // ImageServer returns { value }. MapServer identify returns
  // { results: [{ attributes: { "Pixel Value": ... } }] }.
  const raw = body?.value
    ?? body?.results?.[0]?.attributes?.['Pixel Value']
    ?? body?.results?.[0]?.attributes?.['Stretched value'];
  if (raw == null || raw === 'NoData') return null;
  const value = Number(raw);
  if (!Number.isFinite(value)) return null;
  return { value, url, fetchedAt: response.fetchedAt, fromCache: response.fromCache };
}

async function moonRelief(lat, lon) {
  const spacing = 0.18;
  const measurements = await Promise.allSettled(
    [-spacing, 0, spacing].flatMap((dLat) =>
      [-spacing, 0, spacing].map((dLon) =>
        trekIdentify({
          base: TREK_MOON,
          service: 'LRO_LOLA_DEM_Global_256ppd_v06',
          lat: clamp(lat + dLat, -89.995, 89.995),
          lon: wrapLon(lon + dLon),
          wkid: 104903,
          namespace: 'trek-moon-dem',
          timeout: 18000
        }).then((result) => result?.value ?? null)
      )
    )
  );
  const elevations = measurements
    .filter((entry) => entry.status === 'fulfilled')
    .map((entry) => entry.value)
    .filter(Number.isFinite);
  const index = reliefIndex(elevations);
  if (!index) return null;
  return {
    ...index,
    elevations,
    spacingDegrees: spacing,
    radiusKm: round(spacing * Math.PI * MOON_RADIUS_M / 180 / 1000, 1),
    source: SOURCE.lolaDem
  };
}

async function marsRelief(lat, lon) {
  const spacing = 0.12;
  const measurements = await Promise.allSettled(
    [-spacing, 0, spacing].flatMap((dLat) =>
      [-spacing, 0, spacing].map((dLon) =>
        trekIdentify({
          base: TREK_MARS,
          service: 'mola128_mola64_merge_90Nto90S_SimpleC_clon0',
          lat: clamp(lat + dLat, -89.995, 89.995),
          lon: wrapLon(lon + dLon),
          wkid: 104905,
          namespace: 'trek-mars-dem',
          timeout: 18000
        }).then((result) => result?.value ?? null)
      )
    )
  );
  const elevations = measurements
    .filter((entry) => entry.status === 'fulfilled')
    .map((entry) => entry.value)
    .filter(Number.isFinite);
  const index = reliefIndex(elevations);
  if (!index) return null;
  return {
    ...index,
    elevations,
    spacingDegrees: spacing,
    radiusKm: round(spacing * Math.PI * MARS_RADIUS_M / 180 / 1000, 1),
    source: SOURCE.molaDem
  };
}

async function moonTemperature(lat, lon) {
  const samples = await Promise.allSettled(
    LOCAL_HOURS.map(async (hour) => {
      const result = await trekIdentify({
        base: TREK_MOON,
        service: 'temp_avg_hour',
        type: 'MapServer',
        lat,
        lon,
        wkid: 104903,
        namespace: 'trek-moon-temp',
        timeout: 18000,
        extra: {
          layers: 'all:3',
          tolerance: '2',
          mapExtent: '-180,-90,180,90',
          imageDisplay: '1024,512,96',
          time: String(-2208988800000 + hour * 3600000)
        }
      });
      return result ? { hour, kelvin: result.value } : null;
    })
  );
  const values = samples
    .filter((entry) => entry.status === 'fulfilled' && entry.value)
    .map((entry) => entry.value)
    .filter((sample) => Number.isFinite(sample.kelvin) && sample.kelvin > 0);
  if (values.length < 3) return null;
  const meanK = values.reduce((sum, sample) => sum + sample.kelvin, 0) / values.length;
  const spread = Math.sqrt(values.reduce((sum, sample) => sum + (sample.kelvin - meanK) ** 2, 0) / values.length);
  return {
    value: round(meanK - 273.15, 2),
    // The spread is real diurnal variation, not noise: every sample is an
    // annual average for one local hour. A 5 K allowance covers the numerical
    // integration of the diurnal curve with eight samples (the 8-sample mean
    // differs from a 24-hour integral by ~2.5 K at the equator) plus mapped
    // product representativeness. It is not a published instrument error.
    uncertainty: 5,
    diurnalSpread: round(spread, 2),
    minC: round(Math.min(...values.map((sample) => sample.kelvin)) - 273.15, 2),
    maxC: round(Math.max(...values.map((sample) => sample.kelvin)) - 273.15, 2),
    samples: values.map((sample) => ({ hour: sample.hour, kelvin: round(sample.kelvin, 2) })),
    source: SOURCE.diviner
  };
}

async function moonFeo(lat, lon) {
  if (Math.abs(lat) > 50) return null;
  const result = await trekIdentify({
    base: TREK_MOON,
    service: 'Lunar_Kaguya_MIMap_MineralDeconv_FeOWeightPercent_50N50S',
    lat,
    lon,
    wkid: 104903,
    namespace: 'trek-moon-feo',
    timeout: 18000
  });
  if (!result) return null;
  return { ...moonFeoProxy(result.value), reference: result.url };
}

async function marsGeology(lat, lon) {
  const endpoint = `${TREK_MARS}/SIM3292_Global_Geology/MapServer/0/query`;
  const params = {
    geometry: JSON.stringify({ x: lon, y: lat, spatialReference: { wkid: 104905 } }),
    geometryType: 'esriGeometryPoint',
    inSR: '104905',
    spatialRel: 'esriSpatialRelIntersects',
    outFields: 'Unit,UnitDesc',
    returnGeometry: 'false',
    f: 'json'
  };
  const url = `${endpoint}?${new URLSearchParams(params)}`;
  const response = await fetchCached(url, { namespace: 'trek-mars-geology', timeout: 18000, retries: 2 });
  const attributes = response.body?.features?.[0]?.attributes;
  if (!attributes) return null;
  const proxy = marsGeologyProxy(attributes.Unit, attributes.UnitDesc);
  if (!proxy) return null;
  return { ...proxy, reference: url };
}

async function mcdRequest({ lat, lon, parameters, timeout = 45000, retries = 1 }) {
  const endpoint = new URL(MCD_ENDPOINT);
  // zkey=3 means "m above the local surface". Surface quantities therefore
  // require altitude 0 at every point; the CGI rejects negative values because
  // they would describe a level below the ground. The local surface elevation
  // is still returned from MOLA and reported alongside the MCD values.
  const params = {
    var1: parameters[0], var2: parameters[1] ?? 'none', var3: parameters[2] ?? 'none', var4: 'none',
    datekeyhtml: '1', ls: 'all', localtime: '12',
    latitude: String(lat), longitude: String(lon), altitude: '0',
    zkey: '3', dust: '1', hrkey: '1', averaging: 'diurnal', isfixedlt: 'off',
    iswind: 'off', islog: 'off', dpi: '80', colorm: 'jet', proj: 'cyl'
  };
  Object.entries(params).forEach(([key, value]) => endpoint.searchParams.set(key, value));

  const page = await fetchCached(endpoint.href, {
    namespace: 'mcd-page',
    acceptText: true,
    timeout,
    retries
  });
  const html = page.body;
  if (/Ooops!|Bad syntax|Please correct|AttributeError/i.test(html)) {
    throw new Error('Mars Climate Database rejected the coordinate request');
  }
  const link = html.match(/href=["']([^"']*\.txt)["']/i)?.[1];
  if (!link) throw new Error('Mars Climate Database returned no ASCII data file');
  const dataUrl = new URL(link, endpoint);
  const data = await fetchCached(dataUrl.href, {
    namespace: 'mcd-data',
    acceptText: true,
    timeout,
    retries
  });
  return {
    series: parseMcdSeries(data.body),
    reference: dataUrl.href,
    fetchedAt: data.fetchedAt,
    query: { lat, lon, altitude: 0, altitudeReference: 'm above local surface', parameters }
  };
}

async function marsClimate(lat, lon, surfaceElevationM) {
  const [climate, water] = await Promise.allSettled([
    mcdRequest({ lat, lon, parameters: ['tsurf', 'ps', 'fluxsurf_dn_sw'], timeout: 75000, retries: 0 }),
    // Water/vapour layers are secondary evidence. A slow optional layer must
    // not turn otherwise usable temperature/pressure/solar data into failure.
    mcdRequest({ lat, lon, parameters: ['water_cap', 'col_h2ovapor', 'surf_h2o_ice'], timeout: 12000, retries: 0 })
  ]);
  if (climate.status !== 'fulfilled') {
    return { error: shortError(climate.reason), water: water.status === 'fulfilled' ? water.value : null };
  }
  const series = climate.value.series;
  const tempK = summarizeMcdSeries(series, /surface temperature \(k\)/i);
  const pressurePa = summarizeMcdSeries(series, /surface pressure \(pa\)/i);
  const solarWm2 = summarizeMcdSeries(series, /incident solar flux on horizontal surface \(w\/m2\)/i);
  if (!tempK || !solarWm2) return { error: 'MCD returned incomplete seasonal temperature or flux data', water: null };

  const tempSource = { ...SOURCE.mcd, reference: climate.value.reference };
  const temp = {
    value: round(tempK.mean - 273.15, 2),
    uncertainty: round(Math.max(2, tempK.spread * 0.35), 2),
    seasonalSpread: round(tempK.spread, 2),
    unit: '°C',
    source: tempSource,
    measurementType: 'annual_mean_surface_temperature',
    note: `MCD seasonal mean ${tempK.mean.toFixed(2)} K (${tempK.count}/25 samples) at 0 m above the local surface${Number.isFinite(surfaceElevationM) ? ` (MOLA elevation ${surfaceElevationM} m)` : ''}; uncertainty is a representativeness allowance of at least 2 K, not a published model error.`
  };
  const solar = {
    value: round(solarWm2.mean * 24 / 1000, 3),
    uncertainty: round(Math.max(0.2, solarWm2.spread * 24 / 1000 * 0.35), 2),
    seasonalSpread: round(solarWm2.spread * 24 / 1000, 2),
    unit: 'kWh/m²/day',
    source: { ...tempSource, id: 'mars-climate-database-solar', name: 'Mars Climate Database v6.2 surface solar flux' },
    measurementType: 'annual_mean_surface_shortwave',
    note: `MCD mean downward surface shortwave ${solarWm2.mean.toFixed(1)} W/m² × 24 h / 1000 (${solarWm2.count}/25 samples) at 0 m above the local surface.`
  };

  let pressureKpa = null;
  if (pressurePa) {
    pressureKpa = {
      value: round(pressurePa.mean / 1000, 3),
      uncertainty: round(Math.max(0.01, pressurePa.spread / 1000 * 0.35), 3),
      seasonalSpread: round(pressurePa.spread / 1000, 3),
      unit: 'kPa',
      source: tempSource,
      measurementType: 'annual_mean_surface_pressure',
      note: `MCD seasonal mean ${pressurePa.mean.toFixed(1)} Pa (${pressurePa.count}/25 samples) at 0 m above the local surface.`
    };
  }

  let ice = null;
  let dry = null;
  if (water.status === 'fulfilled') {
    const seriesH2O = water.value.series;
    const layer = summarizeMcdSeries(seriesH2O, /surface H2O layer \(kg\/m2\)/i, 12);
    const vapour = summarizeMcdSeries(seriesH2O, /water vapor column \(kg\/m2\)/i, 12);
    if (layer) {
      const maxKg = maxFinite(mcdColumn(seriesH2O, /surface H2O layer \(kg\/m2\)/i));
      ice = {
        ...marsIceEvidence(layer.mean, maxKg),
        unit: 'index',
        source: { ...SOURCE.mcd, id: 'mars-climate-database-water', name: 'Mars Climate Database v6.2 surface H2O layer', reference: water.value.reference },
        measurementType: 'water_ice_evidence'
      };
    }
    if (vapour) {
      dry = {
        ...marsDryness(vapour.mean),
        unit: 'index',
        source: { ...SOURCE.mcd, id: 'mars-climate-database-vapour', name: 'Mars Climate Database v6.2 water-vapour column', reference: water.value.reference },
      measurementType: 'vacuum_reference'
      };
    }
  }

  return {
    temp,
    solar,
    pressureKpa,
    ice,
    dry,
    reference: climate.value.reference,
    completeness: {
      temp: `${tempK.count}/25 seasonal samples`,
      solar: `${solarWm2.count}/25 seasonal samples`,
      pressure: pressurePa ? `${pressurePa.count}/25 seasonal samples` : 'unavailable',
      ice: ice ? '25 seasonal samples' : 'unavailable',
      dry: dry ? '25 seasonal samples' : 'unavailable'
    }
  };
}

/* ------------------------------------------------------------------ */
/* Public probe                                                        */
/* ------------------------------------------------------------------ */

export async function probeBody(body, lat, lon) {
  if (!['moon', 'mars'].includes(body)) throw new Error('Unsupported body; expected "moon" or "mars".');
  if (!Number.isFinite(lat) || lat < -90 || lat > 90) throw new Error('Latitude must be between -90 and 90.');
  if (!Number.isFinite(lon) || lon < -180 || lon > 180) throw new Error('Longitude must be between -180 and 180.');

  const warnings = [];
  const valueSources = [];
  const completeness = {};
  const values = {};

  if (body === 'moon') {
    const [relief, temperature, feo] = await Promise.all([
      moonRelief(lat, lon).catch((error) => { warnings.push(`LOLA DEM unavailable: ${shortError(error)}`); return null; }),
      moonTemperature(lat, lon).catch((error) => { warnings.push(`Diviner temperature unavailable: ${shortError(error)}`); return null; }),
      moonFeo(lat, lon).catch((error) => { warnings.push(`Kaguya FeO unavailable: ${shortError(error)}`); return null; })
    ]);

    if (temperature) {
      values.temp = {
        ...temperature,
        unit: '°C',
        source: SOURCE.diviner,
        measurementType: 'annual_mean_surface_temperature',
        note: `Diviner annual average at ${temperature.samples.length} local hours (${temperature.samples.map((sample) => sample.hour + 'h').join(', ')}); min ${temperature.minC} °C, max ${temperature.maxC} °C.`
      };
      completeness.temp = `${temperature.samples.length}/${LOCAL_HOURS.length} local-hour samples`;
      valueSources.push(SOURCE.diviner);
    } else {
      completeness.temp = 'unavailable';
    }

    const solar = moonSolarEstimate(lat);
    if (solar) {
      values.solar = {
        ...solar,
        unit: 'kWh/m²/day',
        source: SOURCE.moonSolar,
        measurementType: 'annual_mean_surface_shortwave',
        note: solar.note
      };
      completeness.solar = 'geometric estimate';
      valueSources.push(SOURCE.moonSolar);
    }

    values.dry = {
      value: 100,
      uncertainty: 0,
      unit: 'index',
      source: SOURCE.moonVacuum,
      measurementType: 'atmospheric_water_vapour_proxy',
      note: 'The Moon has no appreciable atmosphere, so the atmospheric dry-air proxy is saturated at 100. This is not a soil-moisture measurement.'
    };
    completeness.dry = 'reference value';
    valueSources.push(SOURCE.moonVacuum);

    if (feo) {
      values.soil = {
        ...feo,
        unit: 'index',
        source: SOURCE.kaguyaFeo,
        measurementType: 'mafic_soil_proxy',
        note: feo.note
      };
      completeness.soil = 'single mapped pixel';
      valueSources.push(SOURCE.kaguyaFeo);
    } else {
      completeness.soil = 'unavailable outside Kaguya FeO coverage (±50°)';
      warnings.push('Kaguya FeO coverage is limited to 50°N–50°S; soil is excluded rather than estimated at this latitude.');
    }

    if (relief) {
      values.terrain = {
        value: relief.value,
        uncertainty: 15,
        unit: 'index',
        source: SOURCE.lolaDem,
        measurementType: 'local_relief_proxy',
        note: `LOLA relief ${relief.reliefM} m over a 3×3 sample spanning about ${relief.radiusKm * 2} km; σ ${relief.stdDevM} m (${relief.count}/9 points).`,
        elevationM: relief.elevations[4] ?? null,
        reliefM: relief.reliefM,
        samples: relief.elevations
      };
      completeness.terrain = `${relief.count}/9 DEM samples`;
      valueSources.push(SOURCE.lolaDem);
    } else {
      completeness.terrain = 'unavailable';
    }

    values.ice = null;
    completeness.ice = 'not queried: no reliable global lunar volatile point product connected';
    warnings.push('No global lunar volatile/ice point product is connected. Ice is excluded from this query instead of being inferred from latitude.');
    warnings.push('Lunar solar illumination is a geometric latitude estimate; local horizon, slopes and permanent shadow are not modelled.');

    const source = {
      id: 'astra-moon-point-probe',
      name: 'NASA Moon Trek: LRO LOLA, LRO Diviner, Kaguya MI',
      url: 'https://trek.nasa.gov/moon/',
      period: 'Mission products; see individual measurements',
      resolution: 'DEM ~118 m/px; mapped composition and Diviner products',
      evidenceType: 'remote_sensing',
      retrievedAt: new Date().toISOString()
    };
    return finalize({
      body, lat, lon, values, completeness, warnings,
      source,
      sources: uniqueSources(valueSources),
      dataset: 'NASA Moon Trek point probe',
      reference: values.terrain?.source?.url || source.url,
      elevationM: values.terrain?.elevationM ?? null
    });
  }

  const [relief, geology] = await Promise.all([
    marsRelief(lat, lon).catch((error) => { warnings.push(`MOLA DEM unavailable: ${shortError(error)}`); return null; }),
    marsGeology(lat, lon).catch((error) => { warnings.push(`SIM3292 geology unavailable: ${shortError(error)}`); return null; })
  ]);

  const elevation = Number.isFinite(relief?.elevations?.[4]) ? Math.round(relief.elevations[4]) : 0;
  const climate = await marsClimate(lat, lon, elevation).catch((error) => ({ error: shortError(error), water: null }));
  if (climate.temp) {
    values.temp = climate.temp;
    completeness.temp = climate.completeness.temp;
    valueSources.push(SOURCE.mcd);
  } else {
    completeness.temp = 'unavailable';
    warnings.push(`Mars temperature unavailable: ${climate.error || 'MCD request failed'}`);
  }
  if (climate.solar) {
    values.solar = climate.solar;
    completeness.solar = climate.completeness.solar;
    valueSources.push(SOURCE.mcd);
  } else {
    completeness.solar = 'unavailable';
  }
  if (climate.pressureKpa) {
    values.pressureKpa = climate.pressureKpa;
    completeness.pressure = climate.completeness.pressure;
    completeness.pressureKpa = climate.completeness.pressure;
  }
  if (climate.ice) {
    values.ice = { ...climate.ice, source: climate.ice.source, measurementType: 'water_ice_evidence' };
    completeness.ice = climate.completeness.ice;
    valueSources.push(SOURCE.mcd);
  } else {
    completeness.ice = 'unavailable';
  }
  if (climate.dry) {
    values.dry = { ...climate.dry, source: climate.dry.source, measurementType: 'atmospheric_water_vapour_proxy' };
    completeness.dry = climate.completeness.dry;
  } else {
    completeness.dry = 'unavailable';
  }

  if (geology) {
    values.soil = {
      ...geology,
      unit: 'index',
      source: SOURCE.marsGeology,
      measurementType: 'mafic_soil_proxy',
      note: geology.note
    };
    completeness.soil = 'single mapped polygon';
    valueSources.push(SOURCE.marsGeology);
  } else {
    completeness.soil = 'unavailable';
  }

  if (relief) {
    values.terrain = {
      value: relief.value,
      uncertainty: 15,
      unit: 'index',
      source: SOURCE.molaDem,
      measurementType: 'local_relief_proxy',
      note: `MOLA relief ${relief.reliefM} m over a 3×3 sample spanning about ${relief.radiusKm * 2} km; σ ${relief.stdDevM} m (${relief.count}/9 points).`,
      elevationM: relief.elevations[4] ?? null,
      reliefM: relief.reliefM,
      samples: relief.elevations
    };
    completeness.terrain = `${relief.count}/9 DEM samples`;
    valueSources.push(SOURCE.molaDem);
  } else {
    completeness.terrain = 'unavailable';
  }

  values.ice = values.ice ?? null;
  completeness.tube = 'not available: no global mapped cave/tube point product';
  warnings.push('Lava-tube access is not evaluated for an arbitrary point; there is no global surveyed cave/tube point dataset for Mars.');
  warnings.push('MCD is a model climatology, not a direct surface station measurement; seasonal spread is reported separately and is not a published model error.');
  if (climate.error) warnings.push(`MCD water/ice products unavailable: ${climate.error}`);

  const source = {
    id: 'astra-mars-point-probe',
    name: 'NASA Mars Trek (MOLA + USGS SIM3292) and Mars Climate Database v6.2',
    url: 'https://trek.nasa.gov/mars/',
    period: 'MOLA/SIM3292 mission maps; MCD v6.2 climatology',
    resolution: 'DEM 128/64 ppd; global geologic units; MCD model grid',
    evidenceType: 'remote_sensing_and_modelled_climatology',
    reference: climate.reference,
    retrievedAt: new Date().toISOString()
  };

  return finalize({
    body, lat, lon, values, completeness, warnings,
    source,
    sources: uniqueSources(valueSources),
    dataset: 'NASA Mars Trek + Mars Climate Database point probe',
    reference: climate.reference || values.terrain?.source?.url || source.url,
    elevationM: values.terrain?.elevationM ?? null
  });
}

function finalize(payload) {
  const present = Object.entries(payload.values)
    .filter(([, value]) => value && Number.isFinite(value.value))
    .map(([key]) => key);
  return {
    schema: PROBE_SCHEMA,
    ...payload,
    presentFeatures: present,
    retrievedAt: new Date().toISOString()
  };
}

/* ------------------------------------------------------------------ */
/* Utilities                                                           */
/* ------------------------------------------------------------------ */

function uniqueSources(sources) {
  const seen = new Set();
  return (sources || []).filter((source) => {
    if (!source?.id || seen.has(source.id)) return false;
    seen.add(source.id);
    return true;
  });
}

function maxFinite(rows) {
  const values = (rows || []).map((row) => row.value).filter(Number.isFinite);
  return values.length ? Math.max(...values) : null;
}

function wrapLon(lon) {
  return ((lon + 180) % 360 + 360) % 360 - 180;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function round(value, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function shortError(error) {
  return String(error?.message || error).slice(0, 160);
}

// Small pacing gap when a caller explicitly probes several points in sequence.
export async function pauseBetweenProbes(ms = 150) {
  await sleep(ms);
}
