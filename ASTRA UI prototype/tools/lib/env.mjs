import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Minimal .env loader (no dependency).
 *
 * Values already present in process.env win, so CI can inject secrets without
 * editing files. The file is read from the project root, then its parent.
 */
export function loadEnv(startDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')) {
  const candidates = [
    path.join(startDir, '.env'),
    path.join(path.dirname(startDir), '.env')
  ];

  for (const file of candidates) {
    if (!fs.existsSync(file)) continue;
    const text = fs.readFileSync(file, 'utf8');
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq < 1) continue;
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (process.env[key] == null || process.env[key] === '') {
        process.env[key] = value;
      }
    }
    return file;
  }
  return null;
}

export function env(key, fallback = '') {
  const value = process.env[key];
  return value == null || value === '' ? fallback : value;
}

/** Never print a secret; this is what the source checker reports. */
export function secretStatus(key) {
  const value = env(key);
  if (!value) return { configured: false, length: 0 };
  return { configured: true, length: value.length, masked: value.slice(0, 3) + '…' };
}

export function contact() {
  return env('ASTRA_CONTACT_EMAIL', 'astra-analog-finder@example.invalid');
}
