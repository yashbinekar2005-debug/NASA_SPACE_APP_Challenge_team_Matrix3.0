import { createThrottle, fetchCached } from '../http.mjs';

/**
 * ISRIC SoilGrids 2.0 point query, 0-5 cm depth.
 * Public, keyless, 250 m resolution.
 *
 * Raw values use SoilGrids' mapped units:
 *   clay/sand/silt  g/kg   -> /10 = %
 *   soc             dg/kg  -> /10 = g/kg
 *   bdod            cg/cm³ -> /100 = kg/dm³
 *   cfvo            cm³/dm³ (vol %) -> /10 = %
 */
const PROPERTIES = ['clay', 'sand', 'silt', 'soc', 'bdod', 'cfvo'];

/**
 * SoilGrids degrades badly when hit concurrently (25 s+ responses), so its
 * requests are serialised. A single call normally takes 2–4 s.
 */
const throttle = createThrottle(1600);

export function soilGridsUrl(lat, lon) {
  const query = new URLSearchParams({
    lon: String(lon),
    lat: String(lat),
    depth: '0-5cm',
    value: 'mean'
  });
  for (const property of PROPERTIES) query.append('property', property);
  // `value` may be repeated; URLSearchParams above only adds one, so append.
  query.append('value', 'uncertainty');
  return `https://rest.isric.org/soilgrids/v2.0/properties/query?${query}`;
}

export async function fetchSoilGrids(lat, lon, { refresh = false } = {}) {
  const url = soilGridsUrl(lat, lon);
  await throttle();
  const response = await fetchCached(url, {
    namespace: 'soilgrids',
    refresh,
    timeout: 45000,
    retries: 2
  });
  const layers = response.body?.properties?.layers;
  if (!Array.isArray(layers)) return null;

  const out = {};
  for (const layer of layers) {
    const values = layer.depths?.[0]?.values || {};
    const factor = Number(layer.unit_measure?.d_factor) || 1;
    const mean = finite(values.mean);
    const uncertainty = finite(values.uncertainty);
    out[layer.name] = {
      mean: mean == null ? null : mean / factor,
      uncertainty: uncertainty == null ? null : uncertainty / factor,
      unit: layer.unit_measure?.target_units || '',
      rawMean: mean
    };
  }

  const hasTexture = out.clay?.mean != null || out.sand?.mean != null || out.silt?.mean != null;
  if (!hasTexture && out.soc?.mean == null) return null;

  return {
    url,
    fetchedAt: response.fetchedAt,
    values: out,
    source: {
      id: 'soilgrids',
      name: 'ISRIC SoilGrids 2.0',
      url: 'https://soilgrids.org/',
      depth: '0-5 cm',
      resolution: '250 m'
    }
  };
}

function finite(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

/** Sand fraction of the fine-earth texture, 0-1. */
export function sandFraction(values) {
  const sand = values?.sand?.mean;
  const clay = values?.clay?.mean;
  const silt = values?.silt?.mean;
  if (![sand, clay, silt].every((value) => Number.isFinite(value))) return null;
  const total = sand + clay + silt;
  return total > 0 ? sand / total : null;
}
