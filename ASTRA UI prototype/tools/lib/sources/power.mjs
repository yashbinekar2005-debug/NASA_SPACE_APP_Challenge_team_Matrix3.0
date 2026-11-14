import { createThrottle, fetchCached } from '../http.mjs';

/**
 * NASA POWER climatology (MERRA-2 / POWER), 2001-2025 monthly + annual means.
 * Public, keyless, ~0.5 degree native resolution.
 *
 * Parameters used:
 *   TS                  Earth skin (surface) temperature, °C
 *   T2M / MIN / MAX     air temperature, °C
 *   PRECTOTCORR         precipitation, mm/day
 *   RH2M                relative humidity at 2 m, %
 *   ALLSKY_SFC_SW_DWN   surface shortwave downward irradiance, kWh/m²/day
 *   GWETROOT / GWETPROF root/profile soil wetness, fraction
 *   SNODP               snow depth, cm
 *   FROST_DAYS          frost days per month, days
 *   WS2M                wind speed at 2 m, m/s
 *   PS                  surface pressure, kPa
 */
const PARAMS = [
  'TS', 'T2M', 'T2M_MIN', 'T2M_MAX', 'PRECTOTCORR', 'RH2M',
  'ALLSKY_SFC_SW_DWN', 'GWETROOT', 'GWETPROF', 'SNODP', 'FROST_DAYS',
  'WS2M', 'PS'
].join(',');

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

/** POWER is happy at ~4 requests/s; a small pace avoids spurious 422s. */
const throttle = createThrottle(260);

export function powerUrl(lat, lon) {
  const query = new URLSearchParams({
    parameters: PARAMS,
    community: 'RE',
    longitude: String(lon),
    latitude: String(lat),
    format: 'JSON'
  });
  return `https://power.larc.nasa.gov/api/temporal/climatology/point?${query}`;
}

export async function fetchPower(lat, lon, { refresh = false } = {}) {
  const url = powerUrl(lat, lon);
  await throttle();
  const response = await fetchCached(url, { namespace: 'power', refresh, timeout: 45000, retries: 3 });
  const parameters = response.body?.properties?.parameter;
  if (!parameters) return null;

  const annual = (key) => finite(parameters[key]?.ANN);
  if (annual('TS') == null && annual('T2M') == null) return null;

  const monthly = (key) => MONTHS
    .map((month) => finite(parameters[key]?.[month]))
    .filter((value) => value != null);

  return {
    url,
    fetchedAt: response.fetchedAt,
    elevation: finite(response.body?.geometry?.coordinates?.[2]),
    annual: {
      ts: annual('TS'),
      t2m: annual('T2M'),
      t2mMin: annual('T2M_MIN'),
      t2mMax: annual('T2M_MAX'),
      precipMmDay: annual('PRECTOTCORR'),
      rh2m: annual('RH2M'),
      solarKwh: annual('ALLSKY_SFC_SW_DWN'),
      soilWetRoot: annual('GWETROOT'),
      soilWetProfile: annual('GWETPROF'),
      snowDepthCm: annual('SNODP'),
      frostDays: annual('FROST_DAYS'),
      windMs: annual('WS2M'),
      pressureKpa: annual('PS')
    },
    monthly: {
      ts: monthly('TS'),
      precipMmDay: monthly('PRECTOTCORR'),
      rh2m: monthly('RH2M'),
      solarKwh: monthly('ALLSKY_SFC_SW_DWN'),
      snowDepthCm: monthly('SNODP'),
      frostDays: monthly('FROST_DAYS')
    },
    source: {
      id: 'nasa-power',
      name: 'NASA POWER / MERRA-2 climatology',
      url: 'https://power.larc.nasa.gov/',
      period: '2001-2025',
      parameters: PARAMS
    }
  };
}

function finite(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= -900) return null;
  return number;
}

/** Standard deviation of monthly means, used to set a data-driven uncertainty. */
export function monthlySpread(values) {
  if (!values || values.length < 2) return null;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}
