import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { env, contact } from './env.mjs';

/**
 * Small HTTP client with:
 *   - an on-disk response cache (so a discovery run is reproducible and cheap)
 *   - exponential backoff for 429/5xx
 *   - a polite concurrency limiter
 *
 * Nothing here invents measurements. A failed request either returns a cached
 * response or throws, and the caller records the feature as unavailable.
 */

const HERE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const CACHE_ROOT = path.resolve(HERE, env('ASTRA_CACHE_DIR', '.cache/astra'));

let cacheHits = 0;
let cacheMisses = 0;
let requestCount = 0;

export function cacheStats() {
  return { hits: cacheHits, misses: cacheMisses, requests: requestCount, dir: CACHE_ROOT };
}

export function resetCacheStats() {
  cacheHits = 0;
  cacheMisses = 0;
  requestCount = 0;
}

function cacheFile(namespace, key) {
  const digest = crypto.createHash('sha1').update(key).digest('hex');
  return path.join(CACHE_ROOT, namespace, `${digest}.json`);
}

async function readCache(file) {
  try {
    const raw = await fs.readFile(file, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function writeCache(file, payload) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(payload, null, 2));
}

/**
 * POWER occasionally answers 422 when several requests arrive at once, even
 * for a valid point. Treat it as retryable, with the response body attached so
 * a real validation error is still visible in the log.
 */
const RETRY_STATUSES = new Set([408, 422, 425, 429, 500, 502, 503, 504, 522, 524]);

/**
 * Serialises the start of requests to one host. Public scientific APIs vary
 * widely in tolerance; a per-source pace is cheaper than being throttled.
 */
export function createThrottle(intervalMs) {
  let last = 0;
  return async function throttle() {
    const wait = intervalMs - (Date.now() - last);
    if (wait > 0) await sleep(wait);
    last = Date.now();
  };
}

/**
 * Fetch JSON with cache.
 * @param {string} url
 * @param {{namespace?: string, refresh?: boolean, headers?: object, timeout?: number, retries?: number, acceptText?: boolean}} options
 */
export async function fetchCached(url, options = {}) {
  const namespace = options.namespace ?? 'http';
  const refresh = options.refresh ?? false;
  const timeout = options.timeout ?? 45000;
  const retries = options.retries ?? 3;
  const file = cacheFile(namespace, options.key ?? url);

  if (!refresh) {
    const cached = await readCache(file);
    if (cached && cached.body !== undefined) {
      cacheHits += 1;
      return { ...cached, fromCache: true };
    }
  }

  let lastError = null;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      requestCount += 1;
      const response = await fetch(url, {
        method: options.method ?? 'GET',
        body: options.body,
        headers: {
          'user-agent': `ASTRA-Analog-Finder/1.0 (${contact()})`,
          accept: options.acceptText ? 'text/csv,text/plain,*/*' : 'application/json',
          ...(options.headers || {})
        },
        signal: controller.signal
      });
      clearTimeout(timer);

      if (RETRY_STATUSES.has(response.status)) {
        const retryAfter = Number(response.headers.get('retry-after'));
        const wait = Number.isFinite(retryAfter) && retryAfter > 0
          ? retryAfter * 1000
          : Math.min(30000, 1000 * 2 ** attempt);
        const detail = await response.text().catch(() => '');
        lastError = new Error(
          `HTTP ${response.status} for ${url}${detail ? ` — ${detail.slice(0, 160).replace(/\s+/g, ' ')}` : ''}`
        );
        if (attempt < retries) {
          await sleep(wait);
          continue;
        }
        throw lastError;
      }

      if (!response.ok) {
        throw new Error(`HTTP ${response.status} for ${url}`);
      }

      const text = await response.text();
      let body;
      if (options.acceptText) {
        body = text;
      } else {
        try {
          body = JSON.parse(text);
        } catch {
          throw new Error(`Non-JSON response from ${url}: ${text.slice(0, 120)}`);
        }
      }

      const payload = {
        url,
        fetchedAt: new Date().toISOString(),
        status: response.status,
        body
      };
      await writeCache(file, payload);
      cacheMisses += 1;
      return { ...payload, fromCache: false };
    } catch (error) {
      clearTimeout(timer);
      lastError = error;
      if (attempt < retries) {
        await sleep(Math.min(30000, 800 * 2 ** attempt));
      }
    }
  }
  throw lastError ?? new Error(`Request failed: ${url}`);
}

/** Run `worker` over items with a hard concurrency limit. */
export async function mapLimit(items, limit, worker) {
  const results = new Array(items.length);
  let next = 0;

  async function run() {
    while (true) {
      const index = next;
      next += 1;
      if (index >= items.length) return;
      try {
        results[index] = await worker(items[index], index);
      } catch (error) {
        results[index] = { __error: error };
      }
    }
  }

  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, run);
  await Promise.all(workers);
  return results;
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function readLocalJson(file) {
  return JSON.parse(await fs.readFile(file, 'utf8'));
}

export { CACHE_ROOT };
