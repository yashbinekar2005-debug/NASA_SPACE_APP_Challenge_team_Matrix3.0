import { createThrottle, fetchCached } from '../http.mjs';
import { env } from '../env.mjs';

/**
 * OpenTopoData public SRTM 90 m point service.
 *
 * One request samples a 3x3 neighbourhood (~9 km spacing) so local relief and
 * roughness are measured instead of assumed. Public limit: 1 request/second,
 * 100 locations/request, 1000 requests/day/IP. An optional key can be supplied
 * through OPEN_TOPO_DATA_API_KEY.
 */
const throttle = createThrottle(1250);

const OFFSETS = [-0.08, 0, 0.08];

export async function fetchRelief(lat, lon, { refresh = false, spacingDeg = 0.08 } = {}) {
  const locations = [];
  for (const dLat of OFFSETS) {
    for (const dLon of OFFSETS) {
      const la = clampLat(lat + dLat * (spacingDeg / 0.08));
      const lo = lon + dLon * (spacingDeg / 0.08);
      locations.push(`${la.toFixed(4)},${lo.toFixed(4)}`);
    }
  }

  const url = `https://api.opentopodata.org/v1/srtm90m?locations=${encodeURIComponent(locations.join('|'))}`;
  await throttle();
  const response = await fetchCached(url, {
    namespace: 'opentopodata',
    refresh,
    timeout: 60000,
    headers: env('OPEN_TOPO_DATA_API_KEY')
      ? { authorization: `Bearer ${env('OPEN_TOPO_DATA_API_KEY')}` }
      : {}
  });

  const results = response.body?.results;
  if (!Array.isArray(results)) return null;
  // SRTM 90 m has no coverage poleward of ~60° N / 56° S. OpenTopoData returns
  // 0 there, which would look like perfectly flat ground. Report it as missing.
  if (lat > 60 || lat < -56) return null;
  const elevations = results
    .map((result) => Number(result.elevation))
    .filter((value) => Number.isFinite(value));

  if (elevations.length < 5) return null;
  const min = Math.min(...elevations);
  const max = Math.max(...elevations);
  const mean = elevations.reduce((sum, value) => sum + value, 0) / elevations.length;
  const variance = elevations.reduce((sum, value) => sum + (value - mean) ** 2, 0) / elevations.length;

  return {
    url,
    fetchedAt: response.fetchedAt,
    elevations,
    centerElevation: elevations[4] ?? null,
    reliefM: max - min,
    stdDevM: Math.sqrt(variance),
    radiusKm: Math.round(spacingDeg * 111),
    dataset: response.body?.results?.[0]?.dataset || 'srtm90m',
    source: {
      id: 'opentopodata-srtm90m',
      name: 'OpenTopoData / NASA SRTM 90 m',
      url: 'https://www.opentopodata.org/',
      resolution: '90 m',
      sampling: '3×3 points, ~9 km apart'
    }
  };
}

function clampLat(lat) {
  return Math.max(-89.9, Math.min(89.9, lat));
}
