import { createThrottle, fetchCached } from '../http.mjs';

/**
 * Macrostrat geologic map API (CC-BY 4.0).
 * Returns the mapped bedrock/sediment units at a point, including lithology
 * strings and geologic ages. Public and keyless.
 */
const throttle = createThrottle(400);

export async function fetchGeology(lat, lon, { refresh = false } = {}) {
  const url = `https://macrostrat.org/api/geologic_units/map?lat=${lat}&lng=${lon}&format=json`;
  await throttle();
  const response = await fetchCached(url, { namespace: 'macrostrat', refresh, timeout: 60000 });
  const data = response.body?.success?.data;
  if (!Array.isArray(data) || !data.length) return null;

  const units = data.slice(0, 6).map((unit) => ({
    name: unit.name || null,
    lith: unit.lith || null,
    description: unit.descrip || null,
    age: unit.best_int_name || unit.t_int_name || null,
    ageMa: Number.isFinite(Number(unit.t_age)) ? Number(unit.t_age) : null,
    scale: unit.scale || null,
    sourceId: unit.source_id ?? null,
    mapId: unit.map_id ?? null
  }));

  return {
    url,
    fetchedAt: response.fetchedAt,
    units,
    primary: choosePrimary(units),
    source: {
      id: 'macrostrat',
      name: 'Macrostrat geologic map',
      url: 'https://macrostrat.org/',
      license: 'CC-BY 4.0',
      resolution: 'mixed, 1:1M to 1:5M'
    }
  };
}

function choosePrimary(units) {
  const rank = { large: 3, medium: 2, small: 1 };
  return [...units].sort((a, b) => (rank[b.scale] || 0) - (rank[a.scale] || 0))[0] || null;
}

