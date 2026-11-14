// Small DOM helpers shared by the UI modules.

export const $ = (selector, root) => (root || document).querySelector(selector);

/** Respect the user's motion preference everywhere animation is optional. */
export const reduceMotion = !!(
  window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches
);
