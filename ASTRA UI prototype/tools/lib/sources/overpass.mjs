import { fetchCached } from '../http.mjs';
import { env } from '../env.mjs';

/**
 * OpenStreetMap cave entrances via the Overpass API.
 *
 * This is the only public, global, machine-readable cave-entrance source we
 * found. It is incomplete: a zero count means "no mapped entrance", not "no
 * cave". The pipeline therefore treats it as a capability proxy and records
 * the incompleteness in the candidate limitations. If Overpass is unavailable
 * the tube feature is left missing rather than guessed.
 */
export async function fetchCaveEntrances(lat, lon, { radiusM = 25000, refresh = false } = {}) {
  const endpoint = env('OVERPASS_URL', 'https://overpass-api.de/api/interpreter');
  const query = `[out:json][timeout:25];node["natural"="cave_entrance"](around:${radiusM},${lat},${lon});out count;`;
  const cacheKey = `overpass:${lat}:${lon}:${radiusM}`;

  try {
    const response = await fetchCached(endpoint, {
      namespace: 'overpass',
      refresh,
      timeout: 35000,
      retries: 1,
      key: cacheKey,
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      method: 'POST',
      body: `data=${encodeURIComponent(query)}`
    });

    const count = parseCount(response.body);
    return {
      url: endpoint,
      fetchedAt: response.fetchedAt,
      available: true,
      count,
      radiusM,
      source: {
        id: 'osm-overpass',
        name: 'OpenStreetMap cave entrances (Overpass)',
        url: 'https://www.openstreetmap.org/',
        license: 'ODbL 1.0',
        caveat: 'Mapped entrances only; absence is not evidence of no cave.'
      }
    };
  } catch (error) {
    return {
      url: endpoint,
      fetchedAt: null,
      available: false,
      count: null,
      radiusM,
      error: String(error.message || error).slice(0, 160),
      source: {
        id: 'osm-overpass',
        name: 'OpenStreetMap cave entrances (Overpass)',
        url: 'https://www.openstreetmap.org/',
        license: 'ODbL 1.0',
        caveat: 'Query failed; tube capability was left as a geology proxy.'
      }
    };
  }
}

function parseCount(body) {
  const elements = body?.elements;
  if (!Array.isArray(elements) || !elements.length) return 0;
  const countElement = elements.find((element) => element.type === 'count');
  if (countElement?.tags?.total != null) return Number(countElement.tags.total) || 0;
  return elements.length;
}
