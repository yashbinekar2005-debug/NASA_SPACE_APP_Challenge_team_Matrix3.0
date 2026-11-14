import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readLocalJson } from './http.mjs';

/**
 * Global land grid built from Natural Earth 1:110m land polygons.
 *
 * The grid is only a screening frame. Every selected cell is later validated
 * against climate, terrain, soil and geological datasets. No analog sites are
 * hard-coded anywhere in this file.
 */

const HERE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const LAND_FILE = path.join(HERE, 'tools', 'data', 'ne_110m_land.geojson');

let landCache = null;

async function landFeatures() {
  if (landCache) return landCache;
  const geojson = await readLocalJson(LAND_FILE);
  landCache = geojson.features
    .filter((feature) => feature.geometry)
    .map((feature) => {
      const geometry = feature.geometry;
      const polygons = geometry.type === 'Polygon'
        ? [geometry.coordinates]
        : geometry.type === 'MultiPolygon'
          ? geometry.coordinates
          : [];
      return polygons.map((polygon) => ({
        rings: polygon,
        bbox: bboxOf(polygon[0])
      }));
    })
    .flat();
  return landCache;
}

function bboxOf(ring) {
  let minLon = Infinity;
  let minLat = Infinity;
  let maxLon = -Infinity;
  let maxLat = -Infinity;
  for (const [lon, lat] of ring) {
    if (lon < minLon) minLon = lon;
    if (lon > maxLon) maxLon = lon;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
  }
  return { minLon, minLat, maxLon, maxLat };
}

function pointInRing(lon, lat, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];
    const intersect = ((yi > lat) !== (yj > lat)) &&
      (lon < ((xj - xi) * (lat - yi)) / (yj - yi || 1e-12) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

export async function isLand(lon, lat) {
  const polygons = await landFeatures();
  for (const polygon of polygons) {
    const { bbox } = polygon;
    if (lon < bbox.minLon || lon > bbox.maxLon || lat < bbox.minLat || lat > bbox.maxLat) continue;
    if (pointInRing(lon, lat, polygon.rings[0])) {
      let inHole = false;
      for (let i = 1; i < polygon.rings.length; i += 1) {
        if (pointInRing(lon, lat, polygon.rings[i])) {
          inHole = true;
          break;
        }
      }
      if (!inHole) return true;
    }
  }
  return false;
}

/** Round a coordinate to a stable id fragment. */
export function coordId(lat, lon) {
  const f = (value, pos, neg) => {
    const rounded = Math.round(value * 10) / 10;
    const abs = Math.abs(rounded).toFixed(1).replace('.', 'p');
    return (rounded >= 0 ? pos : neg) + abs;
  };
  return `${f(lat, 'n', 's')}_${f(lon, 'e', 'w')}`;
}

export function coordLabel(lat, lon) {
  const ns = lat >= 0 ? 'N' : 'S';
  const ew = lon >= 0 ? 'E' : 'W';
  return `${Math.abs(lat).toFixed(1)}°${ns} ${Math.abs(lon).toFixed(1)}°${ew}`;
}

/**
 * Build cell centres over land. A cell is accepted when its centre (or one of
 * four near-centre probes) falls on land, which keeps coasts and islands in the
 * candidate pool without inventing a land mask of our own.
 */
export async function buildLandGrid(step = 6) {
  const cells = [];
  for (let lat = -90 + step / 2; lat < 90; lat += step) {
    for (let lon = -180 + step / 2; lon < 180; lon += step) {
      const probes = [
        [lon, lat],
        [lon + step * 0.28, lat],
        [lon - step * 0.28, lat],
        [lon, lat + step * 0.28],
        [lon, lat - step * 0.28]
      ];
      let hit = null;
      for (const [px, py] of probes) {
        if (py <= -89.5 || py >= 89.5) continue;
        if (await isLand(px, py)) {
          hit = [px, py];
          break;
        }
      }
      if (!hit) continue;
      const [plon, plat] = hit;
      cells.push({
        lat: Math.round(plat * 10) / 10,
        lon: Math.round(plon * 10) / 10,
        cellLat: Math.round(lat * 10) / 10,
        cellLon: Math.round(lon * 10) / 10,
        id: `cell-${coordId(plat, plon)}`
      });
    }
  }
  return cells;
}
