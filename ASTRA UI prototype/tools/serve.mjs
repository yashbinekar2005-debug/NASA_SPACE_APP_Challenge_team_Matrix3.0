import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnv, env } from './lib/env.mjs';
import { parseMcdSeries, summarizeMcdSeries } from './lib/sources/mcd.mjs';
import { fetchPower } from './lib/sources/power.mjs';
import { screenFeatures } from './lib/features.mjs';
import { probeBody } from './lib/planetary-probe.mjs';
import { reverseGeocode } from './lib/sources/geocode.mjs';
import { inflateRawSync } from 'node:zlib';

/**
 * Zero-dependency static server for the ASTRA prototype.
 * The frontend is plain ES modules, so it must be served over HTTP.
 *
 *   node tools/serve.mjs
 *   open http://localhost:4173
 */

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
loadEnv(root);
const port = Number(process.env.PORT) || 4173;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon'
};

function sendJson(response, status, payload) {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store'
  });
  response.end(JSON.stringify(payload));
}

// Short-lived in-process cache so a click that is re-rendered does not repeat
// eight DEM, temperature and MCD requests. The per-source disk cache in
// tools/lib/http.mjs still provides reproducibility across restarts.
const probeCache = new Map();
const PROBE_TTL_MS = 10 * 60 * 1000;
const PROBE_CACHE_MAX = 96;
const planetaryFeatureCache = new Map();

const PLANETARY_GAZETTEER = Object.freeze({
  moon: 'https://asc-planetarynames-data.s3.us-west-2.amazonaws.com/MOON_nomenclature_center_pts.kmz',
  mars: 'https://asc-planetarynames-data.s3.us-west-2.amazonaws.com/MARS_nomenclature_center_pts.kmz'
});

function unzipKml(kmz) {
  // Locate the central directory so entries using ZIP data descriptors are
  // handled correctly; KMZ archives contain a small KML document plus assets.
  let eocd = -1;
  for (let i = kmz.length - 22; i >= Math.max(0, kmz.length - 65557); i -= 1) {
    if (kmz.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('USGS Gazetteer archive has no ZIP directory.');
  const entries = kmz.readUInt16LE(eocd + 10);
  let offset = kmz.readUInt32LE(eocd + 16);
  for (let index = 0; index < entries; index += 1) {
    if (kmz.readUInt32LE(offset) !== 0x02014b50) throw new Error('USGS Gazetteer ZIP directory is malformed.');
    const method = kmz.readUInt16LE(offset + 10);
    const compressedSize = kmz.readUInt32LE(offset + 20);
    const nameLength = kmz.readUInt16LE(offset + 28);
    const extraLength = kmz.readUInt16LE(offset + 30);
    const commentLength = kmz.readUInt16LE(offset + 32);
    const localOffset = kmz.readUInt32LE(offset + 42);
    const name = kmz.toString('utf8', offset + 46, offset + 46 + nameLength);
    if (/\.kml$/i.test(name)) {
      const localNameLength = kmz.readUInt16LE(localOffset + 26);
      const localExtraLength = kmz.readUInt16LE(localOffset + 28);
      const start = localOffset + 30 + localNameLength + localExtraLength;
      const data = kmz.subarray(start, start + compressedSize);
      if (method === 0) return data.toString('utf8');
      if (method === 8) return inflateRawSync(data).toString('utf8');
      throw new Error(`Unsupported USGS Gazetteer compression method ${method}.`);
    }
    offset += 46 + nameLength + extraLength + commentLength;
  }
  throw new Error('USGS Gazetteer archive contains no KML feature layer.');
}

function xmlText(value) {
  return String(value || '').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'").trim();
}

function parsePlanetaryFeatures(kml) {
  const features = [];
  const placemarks = kml.matchAll(/<Placemark\b[^>]*>([\s\S]*?)<\/Placemark>/gi);
  for (const [, placemark] of placemarks) {
    const name = xmlText(placemark.match(/<name\b[^>]*>([\s\S]*?)<\/name>/i)?.[1]);
    const coordinate = placemark.match(/<Point\b[^>]*>[\s\S]*?<coordinates\b[^>]*>\s*([-\d.eE+]+)\s*,\s*([-\d.eE+]+)/i);
    if (!name || !coordinate) continue;
    const lonEast = Number(coordinate[1]);
    const lat = Number(coordinate[2]);
    if (!Number.isFinite(lat) || lat < -90 || lat > 90 || !Number.isFinite(lonEast)) continue;
    const lon = ((lonEast + 180) % 360 + 360) % 360 - 180;
    const fields = [];
    for (const match of placemark.matchAll(/<(Data|SimpleData)\b([^>]*)>([\s\S]*?)<\/\1>/gi)) {
      const fieldName = match[2].match(/\bname=["']([^"']+)["']/i)?.[1] || '';
      const rawValue = match[1].toLowerCase() === 'data'
        ? match[3].match(/<value\b[^>]*>([\s\S]*?)<\/value>/i)?.[1]
        : match[3];
      fields.push([fieldName.toLowerCase().replace(/[^a-z]/g, ''), xmlText(rawValue)]);
    }
    const kind = fields.find(([key, value]) => value && (key === 'type' || key === 'featuretype' || key === 'featureclass'))?.[1] ||
      name.match(/\b(Crater|Basin|Catena|Patera|Mons|Tholus|Planitia|Planum|Vallis|Valles|Fossa|Rupes|Mare|Lacus|Terra|Regio|Chaos|Labyrinthus|Chasma|Dorsum|Dorsa|Rima|Rimae|Sinus|Palus|Oceanus|Promontorium|Insula|Mensa|Mensae|Scopulus|Scopuli|Linea|Lineae)\s*$/i)?.[1] ||
      'IAU-named feature';
    features.push({ name, kind: kind || 'IAU-named feature', lat, lon });
  }
  return [...new Map(features.map((feature) => [`${feature.name.toLowerCase()}:${feature.lat.toFixed(5)}:${feature.lon.toFixed(5)}`, feature])).values()];
}

async function planetaryFeatures(body) {
  const cached = planetaryFeatureCache.get(body);
  if (cached && Date.now() - cached.fetchedAt < 24 * 60 * 60 * 1000) return cached;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);
  try {
    const response = await fetch(PLANETARY_GAZETTEER[body], { signal: controller.signal, headers: { accept: 'application/vnd.google-earth.kmz,application/octet-stream' } });
    if (!response.ok) throw new Error(`USGS/IAU Planetary Gazetteer failed (HTTP ${response.status}).`);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length < 4 || bytes.length > 40 * 1024 * 1024) throw new Error('USGS Gazetteer archive size is invalid.');
    const features = parsePlanetaryFeatures(unzipKml(bytes));
    if (!features.length) throw new Error('USGS Gazetteer returned no named coordinate features.');
    const entry = { features, fetchedAt: Date.now(), sourceUrl: PLANETARY_GAZETTEER[body] };
    planetaryFeatureCache.set(body, entry);
    return entry;
  } finally {
    clearTimeout(timer);
  }
}

async function cachedProbe(body, lat, lon) {
  const key = `${body}:${lat.toFixed(4)}:${lon.toFixed(4)}`;
  const hit = probeCache.get(key);
  if (hit && Date.now() - hit.time < PROBE_TTL_MS) return hit.payload;
  const payload = await probeBody(body, lat, lon);
  probeCache.set(key, { time: Date.now(), payload });
  if (probeCache.size > PROBE_CACHE_MAX) {
    probeCache.delete(probeCache.keys().next().value);
  }
  return payload;
}

async function fetchMarsClimatePoint(lat, lon) {
  const endpoint = new URL('https://www-mars.lmd.jussieu.fr/mcd_python/cgi-bin/mcdcgi.py');
  const params = {
    var1: 'tsurf', var2: 'ps', var3: 'fluxsurf_dn_sw', var4: 'none',
    datekeyhtml: '1', ls: 'all', localtime: '12', latitude: String(lat),
    longitude: String(lon), altitude: '0', zkey: '3', dust: '1', hrkey: '1',
    averaging: 'diurnal', isfixedlt: 'off', iswind: 'off', islog: 'off',
    dpi: '80', colorm: 'jet', proj: 'cyl'
  };
  Object.entries(params).forEach(([key, value]) => endpoint.searchParams.set(key, value));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 45000);
  try {
    const page = await fetch(endpoint, { signal: controller.signal, headers: { accept: 'text/html' } });
    if (!page.ok) throw new Error(`MCD request failed (HTTP ${page.status})`);
    const html = await page.text();
    if (/Ooops!|Bad syntax|Please correct/i.test(html)) throw new Error('Mars Climate Database rejected the coordinate request');
    const link = html.match(/href=["']([^"']*\.txt)["']/i)?.[1];
    if (!link) throw new Error('Mars Climate Database returned no seasonal data file');
    const dataUrl = new URL(link, endpoint);
    const dataResponse = await fetch(dataUrl, { signal: controller.signal, headers: { accept: 'text/plain' } });
    if (!dataResponse.ok) throw new Error(`Mars Climate Database data file failed (HTTP ${dataResponse.status})`);
    const series = parseMcdSeries(await dataResponse.text());
    const tempK = summarizeMcdSeries(series, /surface temperature \(k\)/i);
    const pressurePa = summarizeMcdSeries(series, /surface pressure \(pa\)/i);
    const solarWm2 = summarizeMcdSeries(series, /incident solar flux on horizontal surface \(w\/m2\)/i);
    if (!tempK || !pressurePa || !solarWm2) {
      throw new Error('Mars Climate Database returned incomplete seasonal measurements');
    }
    const source = {
      id: 'mars-climate-database-6.2',
      name: 'LMD/OU/IAA/ESA/CNES Mars Climate Database v6.2',
      url: 'https://www-mars.lmd.jussieu.fr/mars/access',
      reference: dataUrl.href,
      period: '12-season climatology; diurnal means; 25 seasonal samples',
      resolution: 'Interpolated from the MCD spatial and seasonal model grid',
      retrievedAt: new Date().toISOString(),
      evidenceType: 'modelled_climatology'
    };
    return {
      source,
      values: {
        temp: { value: tempK.mean - 273.15, uncertainty: null, seasonalSpread: tempK.spread, unit: '°C', source, observationPeriod: source.period },
        solar: { value: solarWm2.mean * 24 / 1000, uncertainty: null, seasonalSpread: solarWm2.spread * 24 / 1000, unit: 'kWh/m²/day', source, observationPeriod: source.period },
        pressureKpa: { value: pressurePa.mean / 1000, uncertainty: null, seasonalSpread: pressurePa.spread / 1000, unit: 'kPa', source, observationPeriod: source.period }
      },
      completeness: {
        temp: `${tempK.count}/25 seasonal samples`,
        solar: `${solarWm2.count}/25 seasonal samples`,
        pressure: `${pressurePa.count}/25 seasonal samples`
      }
    };
  } finally {
    clearTimeout(timer);
  }
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url || '/', `http://${request.headers.host}`);

  if (url.pathname === '/api/probe' && request.method === 'GET') {
    const body = String(url.searchParams.get('body') || '').toLowerCase();
    const lat = Number(url.searchParams.get('lat'));
    const lon = Number(url.searchParams.get('lon'));
    if (!['moon', 'mars'].includes(body)) {
      sendJson(response, 400, { error: 'body must be "moon" or "mars".' });
      return;
    }
    if (!Number.isFinite(lat) || lat < -90 || lat > 90 || !Number.isFinite(lon) || lon < -180 || lon > 180) {
      sendJson(response, 400, { error: 'Latitude/longitude must be valid decimal degrees.' });
      return;
    }
    try {
      sendJson(response, 200, await cachedProbe(body, lat, lon));
    } catch (error) {
      sendJson(response, 502, {
        body,
        coordinate: { latitude: lat, longitude: lon },
        error: error.name === 'AbortError' ? 'Planetary data request timed out.' : error.message || 'Planetary data request failed.'
      });
    }
    return;
  }

  if (url.pathname === '/api/planetary-locations' && request.method === 'GET') {
    const body = String(url.searchParams.get('body') || '').toLowerCase();
    const query = String(url.searchParams.get('q') || '').trim().slice(0, 80);
    const offset = Math.max(0, Math.floor(Number(url.searchParams.get('offset')) || 0));
    const requestedLimit = Math.floor(Number(url.searchParams.get('limit')) || 40);
    const limit = Math.max(1, Math.min(100, requestedLimit));
    if (!['moon', 'mars'].includes(body)) {
      sendJson(response, 400, { dataset: 'USGS/IAU Gazetteer of Planetary Nomenclature', error: 'body must be "moon" or "mars".' });
      return;
    }
    if (query.length < 2) {
      sendJson(response, 200, { dataset: 'USGS/IAU Gazetteer of Planetary Nomenclature', body, query, total: 0, offset, limit, results: [], hasMore: false, source: 'https://planetarynames.wr.usgs.gov/GIS_Downloads' });
      return;
    }
    try {
      const catalog = await planetaryFeatures(body);
      const normalizedQuery = query.toLowerCase();
      const matches = catalog.features.filter((feature) =>
        feature.name.toLowerCase().includes(normalizedQuery) || feature.kind.toLowerCase().includes(normalizedQuery));
      matches.sort((a, b) => Number(!a.name.toLowerCase().startsWith(query.toLowerCase())) - Number(!b.name.toLowerCase().startsWith(query.toLowerCase())) || a.name.localeCompare(b.name));
      sendJson(response, 200, {
        dataset: 'USGS/IAU Gazetteer of Planetary Nomenclature', body, query,
        total: matches.length,
        offset,
        limit,
        results: matches.slice(offset, offset + limit),
        hasMore: offset + limit < matches.length,
        source: 'https://planetarynames.wr.usgs.gov/GIS_Downloads',
        sourceFile: catalog.sourceUrl,
        retrievedAt: new Date(catalog.fetchedAt).toISOString()
      });
    } catch (error) {
      sendJson(response, 502, {
        dataset: 'USGS/IAU Gazetteer of Planetary Nomenclature', body,
        error: error.name === 'AbortError' ? 'USGS Gazetteer query timed out.' : error.message || 'USGS Gazetteer request failed.'
      });
    }
    return;
  }

  if (url.pathname === '/api/mars-point' && request.method === 'GET') {
    const lat = Number(url.searchParams.get('lat'));
    const lon = Number(url.searchParams.get('lon'));
    if (!Number.isFinite(lat) || lat < -90 || lat > 90 || !Number.isFinite(lon) || lon < -180 || lon > 180) {
      sendJson(response, 400, { dataset: 'Mars Climate Database v6.2', error: 'Latitude/longitude must be valid decimal degrees.' });
      return;
    }
    try {
      sendJson(response, 200, { dataset: 'Mars Climate Database v6.2', ...(await fetchMarsClimatePoint(lat, lon)) });
    } catch (error) {
      sendJson(response, 502, {
        dataset: 'Mars Climate Database v6.2',
        error: error.name === 'AbortError' ? 'Mars Climate Database request timed out.' : error.message || 'Mars Climate Database request failed.'
      });
    }
    return;
  }

  if (url.pathname === '/api/earth-point' && request.method === 'GET') {
    const lat = Number(url.searchParams.get('lat'));
    const lon = Number(url.searchParams.get('lon'));
    if (!Number.isFinite(lat) || lat < -90 || lat > 90 || !Number.isFinite(lon) || lon < -180 || lon > 180) {
      sendJson(response, 400, { dataset: 'NASA POWER / MERRA-2', error: 'Latitude/longitude must be valid decimal degrees.' });
      return;
    }
    try {
      const power = await fetchPower(lat, lon, { refresh: true });
      const features = screenFeatures(power);
      if (!power || !features || !Object.values(features).some((value) => value && Number.isFinite(value.value))) {
        throw new Error('NASA POWER returned no usable coordinate measurements.');
      }
      const location = await reverseGeocode(lat, lon, { refresh: true });
      sendJson(response, 200, {
        dataset: 'NASA POWER / MERRA-2',
        retrievedAt: power.fetchedAt,
        coordinate: { latitude: lat, longitude: lon },
        source: { ...power.source, reference: power.url, observationPeriod: power.source.period, resolution: 'Product-specific POWER grids: MERRA-2 meteorology about 0.5 x 0.625 degrees; CERES solar/AOD about 1 degree; values are grid-resampled at the requested coordinates.' },
        values: power.annual,
        features,
        location: location ? {
          name: location.locality || location.city || location.subdivision || location.country || null,
          country: location.country,
          subdivision: location.subdivision,
          continent: location.continent,
          source: location.source,
          reference: location.url,
          retrievedAt: location.fetchedAt
        } : null,
        completeness: Object.fromEntries(Object.entries(features).map(([key, value]) => [key, value ? 'measured' : 'unavailable']))
      });
    } catch (error) {
      sendJson(response, 502, {
        dataset: 'NASA POWER / MERRA-2',
        error: error.message || 'NASA POWER coordinate query failed.'
      });
    }
    return;
  }

  // Credentials remain server-side. Never serialize their value to the UI.
  if (url.pathname === '/api/auth/status' && request.method === 'GET') {
    const token = env('NASA_EARTHDATA_TOKEN');
    if (!token) {
      response.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
      response.end(JSON.stringify({ earthdata: { status: 'missing' } }));
      return;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
      // CMR GraphQL explicitly validates supplied EDL tokens. This performs
      // an authenticated, minimal catalog query rather than just checking .env.
      const check = await fetch('https://graphql.earthdata.nasa.gov/api', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          accept: 'application/json',
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          query: 'query Collections($params: CollectionsInput) { collections(params: $params) { count items { conceptId } } }',
          variables: { params: { limit: 1 } }
        }),
        signal: controller.signal
      });
      const payload = check.ok ? await check.json().catch(() => null) : null;
      const graphqlError = payload?.errors?.some((entry) => /token|authenticat|unauthoriz/i.test(entry.message || ''));
      const valid = Array.isArray(payload?.data?.collections?.items);
      const status = valid ? 'valid' : [401, 403].includes(check.status) || graphqlError ? 'invalid' : 'unavailable';
      response.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
      response.end(JSON.stringify({ earthdata: { status, ...(status === 'unavailable' ? { httpStatus: check.status } : {}) } }));
    } catch (error) {
      response.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
      response.end(JSON.stringify({ earthdata: { status: 'unavailable', error: error.name === 'AbortError' ? 'timeout' : 'network_error' } }));
    } finally {
      clearTimeout(timer);
    }
    return;
  }

  const requested = decodeURIComponent(url.pathname);
  const relative = requested === '/' ? 'index.html' : requested.replace(/^\/+/, '');
  const filePath = path.resolve(root, relative);

  if (!filePath.startsWith(root + path.sep) && filePath !== root) {
    response.writeHead(403, { 'content-type': 'text/plain' });
    response.end('Forbidden');
    return;
  }

  fs.readFile(filePath, (error, data) => {
    if (error) {
      response.writeHead(error.code === 'ENOENT' ? 404 : 500, {
        'content-type': 'text/plain; charset=utf-8'
      });
      response.end(error.code === 'ENOENT' ? 'Not found' : 'Server error');
      return;
    }

    response.writeHead(200, {
      'content-type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
      'cache-control': 'no-cache'
    });
    response.end(data);
  });
});

server.listen(port, () => {
  console.log(`ASTRA prototype: http://localhost:${port}`);
});
