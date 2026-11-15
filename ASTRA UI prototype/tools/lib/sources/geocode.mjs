import { fetchCached } from '../http.mjs';

/**
 * BigDataCloud reverse geocoder. Public client endpoint, no key.
 * Used only for human-readable site labels; it never affects the score.
 */
export async function reverseGeocode(lat, lon, { refresh = false } = {}) {
  const query = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lon),
    localityLanguage: 'en'
  });
  const url = `https://api.bigdatacloud.net/data/reverse-geocode-client?${query}`;
  try {
    const response = await fetchCached(url, { namespace: 'geocode', refresh, timeout: 30000, retries: 1 });
    const body = response.body || {};
    return {
      url,
      fetchedAt: response.fetchedAt,
      locality: body.locality || null,
      city: body.city || null,
      subdivision: body.principalSubdivision || null,
      country: body.countryName || null,
      countryCode: body.countryCode || null,
      continent: body.continent || null,
      source: {
        id: 'bigdatacloud',
        name: 'BigDataCloud reverse geocode',
        url: 'https://www.bigdatacloud.com/'
      }
    };
  } catch (error) {
    return {
      url,
      fetchedAt: null,
      error: String(error?.message || error).slice(0, 120),
      source: {
        id: 'bigdatacloud',
        name: 'BigDataCloud reverse geocode',
        url: 'https://www.bigdatacloud.com/'
      }
    };
  }
}
