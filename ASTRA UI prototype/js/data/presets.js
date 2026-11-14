/**
 * Weight presets for the six factors (0–100 each).
 * Presets are matched against the live weights by equality, so the
 * "active" pill clears as soon as a slider is moved.
 */
export const PRESETS = [
  { id: 'balanced', label: 'Balanced', w: { temp: 50, ice: 50, soil: 50, terrain: 50, dry: 50, tube: 50 } },
  { id: 'drill', label: 'Rover drill test', w: { temp: 30, ice: 20, soil: 90, terrain: 80, dry: 70, tube: 0 } },
  { id: 'habitat', label: 'Habitat shelter', w: { temp: 70, ice: 20, soil: 50, terrain: 40, dry: 30, tube: 90 } },
  { id: 'ice', label: 'Ice mining', w: { temp: 70, ice: 95, soil: 50, terrain: 70, dry: 20, tube: 0 } }
];
