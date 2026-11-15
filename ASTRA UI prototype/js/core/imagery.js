const GIBS = 'https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi';
const dateString = (date) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date || ''))) return null;
  const d = new Date(`${date}T00:00:00Z`);
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === date ? date : null;
};
function bounds(lat, lon, span = 0.5) {
  const s = Math.max(-89.9, lat - span), n = Math.min(89.9, lat + span);
  const w = lon - span, e = lon + span;
  return `${s},${w},${n},${e}`;
}
function wms(layer, lat, lon, date, size = 512, format = 'image/jpeg') {
  const p = new URLSearchParams({ SERVICE: 'WMS', REQUEST: 'GetMap', VERSION: '1.3.0',
    LAYERS: layer, CRS: 'EPSG:4326', BBOX: bounds(lat, lon), WIDTH: String(size), HEIGHT: String(size),
    FORMAT: format, TRANSPARENT: format === 'image/png' ? 'true' : 'false', TIME: date });
  return `${GIBS}?${p}`;
}
function trekTile(body, layer, lat, lon, zoom = 8) {
  // NASA Trek serves planetary basemaps through WMTS; GIBS is the Earth
  // imagery endpoint. These global mosaics use an equirectangular matrix with
  // 2 columns x 1 row at zoom 0, doubling each dimension at each zoom.
  const columns = 2 ** (zoom + 1), rows = 2 ** zoom;
  const wrappedLon = ((lon + 180) % 360 + 360) % 360;
  const x = Math.min(columns - 1, Math.floor(wrappedLon / 360 * columns));
  const y = Math.min(rows - 1, Math.max(0, Math.floor((90 - Math.max(-90, Math.min(90, lat))) / 180 * rows)));
  const bodyName = body === 'moon' ? 'Moon' : 'Mars';
  return `https://trek.nasa.gov/tiles/${bodyName}/EQ/${layer}/1.0.0/default/default028mm/${zoom}/${y}/${x}.jpg`;
}
function trekTileFallbacks(body, layer, lat, lon, startZoom = 7) {
  return Array.from({ length: startZoom + 1 }, (_, index) =>
    trekTile(body, layer, lat, lon, startZoom - index));
}
function planetaryTile(body, lat, lon) {
  if (body === 'moon') {
    const layer = 'LRO_WAC_Mosaic_Global_303ppd_v02';
    return { url: trekTile(body, layer, lat, lon), fallback: null,
      fallbacks: trekTileFallbacks(body, layer, lat, lon), layer: 'LRO WAC global mosaic (303 ppd)' };
  }
  const globalLayer = 'Mars_Viking_MDIM21_ClrMosaic_global_232m';
  const global = trekTile(body, globalLayer, lat, lon);
  const globalFallbacks = trekTileFallbacks(body, globalLayer, lat, lon);
  // The controlled Jezero ortho mosaic is geographic/EQ and has a smaller
  // documented footprint than the regional polar mosaic. Request it only in
  // that footprint; use progressively coarser global tiles outside coverage.
  const inJezeroMosaic = lat >= 18.3067994 && lat <= 18.669315 && lon >= 77.2229331 && lon <= 77.583964;
  if (inJezeroMosaic) {
    const jezeroLayer = 'JEZ_hirise_soc_006_orthoMosaic_25cm_Eqc_latTs0_lon0_first_dd';
    const jezero = trekTile(body, jezeroLayer, lat, lon);
    return { url: jezero, fallback: global,
      fallbacks: [...trekTileFallbacks(body, jezeroLayer, lat, lon), ...globalFallbacks],
      layer: 'HiRISE controlled Jezero orthomosaic (25 cm)' };
  }
  return { url: global, fallback: null, fallbacks: globalFallbacks,
    layer: 'Viking MDIM21 global color mosaic (232 m)' };
}
export function pointImage(body, lat, lon, date = null, satellite = 'Terra') {
  const validDate = dateString(date);
  if (body === 'earth') {
    const sat = satellite === 'Aqua' ? 'Aqua' : 'Terra';
    const layer = `MODIS_${sat}_CorrectedReflectance_TrueColor`;
    const noDateSelected = date == null || date === '';
    const time = validDate || (noDateSelected ? 'default' : null);
    const fallbackDates = noDateSelected
      ? Array.from({ length: 30 }, (_, index) => dateOffset(new Date().toISOString().slice(0, 10), index + 1))
      : [];
    return { url: time ? wms(layer, lat, lon, time, 512, 'image/png') : null, fallback: null,
      fallbacks: fallbackDates.map((fallbackDate) => wms(layer, lat, lon, fallbackDate, 512, 'image/png')),
      fallbackDates,
      source: `NASA GIBS - MODIS ${sat} true color`, date: validDate,
      latest: noDateSelected,
      citation: validDate ? `Daily satellite composite for ${validDate}; local clouds and observation coverage vary.` : 'Showing NASA GIBS latest/default available capture; choose a date for a specific observation.' };
  }
  const product = planetaryTile(body, lat, lon);
  return { ...product, source: `NASA/JPL Trek - ${product.layer}`,
    citation: 'Coordinate-centered NASA Trek WMTS tile; mosaic footprints and effective resolution vary by location.' };
}

function dateOffset(date, days) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() - days);
  return value.toISOString().slice(0, 10);
}
async function cloudFractionAssessment(lat, lon, date, satellite) {
  const url = wms(`MODIS_${satellite}_Cloud_Fraction_Day`, lat, lon, date, 96).replace('image/jpeg', 'image/png');
  const response = await fetch(url, { mode: 'cors' });
  if (!response.ok) throw new Error(`NASA GIBS ${satellite} cloud-fraction layer returned HTTP ${response.status}`);
  const blob = await response.blob();
  const bitmap = await createImageBitmap(blob);
  const imageWidth = bitmap.width, imageHeight = bitmap.height;
  const canvas = document.createElement('canvas'); canvas.width = imageWidth; canvas.height = imageHeight;
  const ctx = canvas.getContext('2d', { willReadFrequently: true }); ctx.drawImage(bitmap, 0, 0);
  const pixels = ctx.getImageData(0, 0, bitmap.width, bitmap.height).data;
  bitmap.close?.();
  // Compare every observed pixel to NASA's published cloud-fraction legend instead
  // of treating color names as measurements. This remains a screening estimate.
  const palette = await cloudLegendPalette();
  let observed = 0, relativelyClear = 0;
  for (let i = 3; i < pixels.length; i += 4) {
    if (pixels[i] < 128) continue;
    observed++;
    const r = pixels[i - 3], g = pixels[i - 2], b = pixels[i - 1];
    let nearest = null, distance = Infinity;
    for (const sample of palette) {
      const d = (r - sample.r) ** 2 + (g - sample.g) ** 2 + (b - sample.b) ** 2;
      if (d < distance) { distance = d; nearest = sample; }
    }
    if (nearest && nearest.fraction <= 24) relativelyClear++;
  }
  const total = imageWidth * imageHeight;
  return { date, satellite, observedPixels: observed, coveragePercent: observed / total * 100,
    clearPixelPercent: observed ? relativelyClear / observed * 100 : 0,
    metric: 'share of observed pixels matched to NASA legend cloud-fraction bins <=24%' };
}

let legendPaletteRequest;
function cloudLegendPalette() {
  if (!legendPaletteRequest) legendPaletteRequest = (async () => {
    const response = await fetch('https://gibs.earthdata.nasa.gov/legends/MODIS_Cloud_Fraction_H.png', { mode: 'cors' });
    if (!response.ok) throw new Error(`NASA GIBS cloud legend returned HTTP ${response.status}`);
    const bitmap = await createImageBitmap(await response.blob());
    const canvas = document.createElement('canvas'); canvas.width = bitmap.width; canvas.height = bitmap.height;
    const context = canvas.getContext('2d', { willReadFrequently: true }); context.drawImage(bitmap, 0, 0);
    const data = context.getImageData(0, 0, bitmap.width, bitmap.height).data;
    const y = Math.min(bitmap.height - 1, Math.round(bitmap.height * 0.4));
    const start = Math.round(bitmap.width * 33 / 420), end = Math.round(bitmap.width * 388 / 420), palette = [];
    const stops = [[43, 0], [68, 8.5], [103, 21.5], [144, 34], [188, 46.5], [233, 59.5], [278, 72], [323, 84.5], [376, 100]];
    for (let x = start; x <= end; x++) {
      const i = (y * bitmap.width + x) * 4;
      const legendX = x / bitmap.width * 420;
      let segment = 0;
      while (segment < stops.length - 2 && legendX > stops[segment + 1][0]) segment++;
      const [x0, v0] = stops[segment], [x1, v1] = stops[segment + 1];
      const fraction = v0 + (v1 - v0) * Math.max(0, Math.min(1, (legendX - x0) / (x1 - x0)));
      palette.push({ r: data[i], g: data[i + 1], b: data[i + 2], fraction });
    }
    bitmap.close?.();
    return palette;
  })().catch((error) => { legendPaletteRequest = null; throw error; });
  return legendPaletteRequest;
}

export async function findClearestEarthCapture(lat, lon, endDate, lookbackDays = 30, onProgress = () => {}) {
  const end = dateString(endDate);
  if (!end) throw new Error('Choose a valid observation date first.');
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) throw new Error('The selected Earth coordinate is invalid.');
  const days = Math.min(180, Math.max(1, Math.trunc(Number(lookbackDays) || 30)));
  const jobs = [];
  for (let offset = 0; offset < days; offset++) {
    const date = dateOffset(end, offset);
    if (date > new Date().toISOString().slice(0, 10)) continue;
    jobs.push({ date, satellite: 'Terra' }, { date, satellite: 'Aqua' });
  }
  const usable = []; let cursor = 0, complete = 0; const failures = [];
  await Promise.all(Array.from({ length: 4 }, async () => {
    while (cursor < jobs.length) {
      const job = jobs[cursor++];
      onProgress({ completed: complete, total: jobs.length, ...job });
      try {
        const item = await cloudFractionAssessment(lat, lon, job.date, job.satellite);
        if (item.observedPixels >= 64 && item.coveragePercent >= 20) usable.push(item);
      } catch (error) { failures.push(`${job.date} ${job.satellite}: ${error.message}`); }
      complete++;
      onProgress({ completed: complete, total: jobs.length, ...job });
    }
  }));
  if (!usable.length) throw new Error(failures.length ? `NASA GIBS cloud observations unavailable. ${failures[0]}` : 'NASA GIBS returned no usable cloud-fraction observations in the selected date window.');
  usable.sort((a, b) => b.clearPixelPercent - a.clearPixelPercent || b.coveragePercent - a.coveragePercent || b.date.localeCompare(a.date));
  return { ...usable[0], candidatesChecked: jobs.length, source: 'NASA EOSDIS GIBS MODIS daily cloud fraction',
    sourceUrl: 'https://nasa-gibs.github.io/gibs-api-docs/map-library-usage/',
    note: 'This is an approximate cloud-fraction screen for the selected site window, not a guarantee that every pixel in the rendered image is cloud-free.' };
}

/** Detect whether a transparent GIBS PNG contains any mapped satellite pixels. */
export function hasVisibleImageCoverage(image, minimumFraction = 0.001) {
  try {
    if (!image?.naturalWidth || !image?.naturalHeight) return false;
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    context.drawImage(image, 0, 0);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let covered = 0;
    for (let alpha = 3; alpha < pixels.length; alpha += 4) {
      if (pixels[alpha] >= 128 && (pixels[alpha - 1] > 8 || pixels[alpha - 2] > 8 || pixels[alpha - 3] > 8)) covered++;
    }
    return covered / (canvas.width * canvas.height) >= minimumFraction;
  } catch {
    // A CORS restriction should not suppress a valid image; let the browser show it.
    return true;
  }
}
