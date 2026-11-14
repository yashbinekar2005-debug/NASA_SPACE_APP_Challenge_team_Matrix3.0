import { PRESETS, targetOf } from '../data/index.js';

/**
 * Single mutable app state. Modules read it directly and mutations go
 * through the controller in js/main.js (selectTarget, selectAnalog,
 * setView, updateWeights) so every screen stays in sync.
 */
export const state = {
  mode: 'moon',
  // The user must choose a supported measured target; never preselect a site.
  targetId: null,
  customTarget: null,
  customEarthPoint: null,
  analogId: null,
  weights: Object.assign({}, PRESETS[0].w),
  view: 'explore',
  ranked: []
};

export const curTarget = () => state.customTarget || targetOf(state.targetId);
