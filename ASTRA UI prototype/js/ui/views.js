import { $ } from '../utils/dom.js';
import { state } from '../core/state.js';
import { renderCompare, clearTerrains } from './compare.js';
import { layoutStage, flyEarth, flyOther } from './stage.js';

/**
 * Screen routing: Explore <-> Compare, kept in the URL hash so a match can
 * be linked to and the browser back button behaves.
 */

const backToExplore = () => setView('explore');

export function setView(view) {
  state.view = view;
  $('#viewExplore').hidden = view !== 'explore';
  $('#viewCompare').hidden = view !== 'compare';
  $('#tabExplore').setAttribute('aria-selected', String(view === 'explore'));
  $('#tabCompare').setAttribute('aria-selected', String(view === 'compare'));

  if (view === 'compare') {
    renderCompare({ onBack: backToExplore });
    try {
      if (location.hash !== '#compare') location.hash = 'compare';
    } catch (_) { /* ignore */ }
  } else {
    clearTerrains();
    try {
      if (location.hash) history.replaceState(null, '', location.pathname + location.search);
    } catch (_) { /* ignore */ }
    requestAnimationFrame(() => {
      layoutStage();
      flyEarth();
      flyOther();
    });
  }

  window.scrollTo(0, 0);
}

/** Re-render the compare screen for the current state (e.g. after a change). */
export function refreshCompare() {
  renderCompare({ onBack: backToExplore });
}

export function initViews() {
  $('#openCompare').addEventListener('click', () => setView('compare'));
  $('#tabExplore').addEventListener('click', () => setView('explore'));
  $('#tabCompare').addEventListener('click', () => setView('compare'));

  window.addEventListener('hashchange', () => {
    const v = location.hash === '#compare' ? 'compare' : 'explore';
    if (v !== state.view) setView(v);
  });
}
