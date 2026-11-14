import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnv, env } from './lib/env.mjs';
import { parseMcdSeries, summarizeMcdSeries } from './lib/sources/mcd.mjs';
import { fetchPower } from './lib/sources/power.mjs';
import { screenFeatures } from './lib/features.mjs';
import { probeBody } from './lib/planetary-probe.mjs';

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
      sendJson(response, 200, {
        dataset: 'NASA POWER / MERRA-2',
        retrievedAt: power.fetchedAt,
        coordinate: { latitude: lat, longitude: lon },
        source: { ...power.source, reference: power.url, observationPeriod: power.source.period, resolution: 'Approximately 0.5° native model grid; coordinate values are grid-resampled.' },
        values: power.annual,
        features,
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
