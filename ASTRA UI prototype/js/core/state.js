import { PRESETS, targetOf } from '../data/index.js';

/**
 * Single mutable app state. Modules read it directly and mutations go
 * through the controller in js/main.js (selectTarget, selectAnalog,
 * setView, updateWeights) so every screen stays in sync.
 */
export const state = {
  mode: 'moon',
  targetId: 'shackleton',
  analogId: null,
  weights: Object.assign({}, PRESETS[0].w),
  view: 'explore',
  ranked: []
};

export const curTarget = () => targetOf(state.targetId);
