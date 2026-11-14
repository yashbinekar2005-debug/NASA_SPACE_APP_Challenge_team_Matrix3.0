/**
 * Public data layer. UI and logic import from here, never from the
 * individual files, so datasets can be swapped (API, JSON) in one place.
 */
export { FACTORS } from './factors.js';
export { TARGETS } from './targets.js';
export { ANALOGS } from './analogs.js';
export { PRESETS } from './presets.js';

import { TARGETS } from './targets.js';
import { ANALOGS } from './analogs.js';

export const targetOf = (id) => TARGETS.find((t) => t.id === id);
export const analogOf = (id) => ANALOGS.find((a) => a.id === id);
export const targetsFor = (body) => TARGETS.filter((t) => t.body === body);
