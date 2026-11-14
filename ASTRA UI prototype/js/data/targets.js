/**
 * Space targets: the destinations an Earth site should stand in for.
 *
 * `conf`   — how well documented the site is in public data (Low/Medium/High)
 * `tp`     — parameters for the procedural terrain preview
 * `goal`   — the mission objective shown on the compare screen
 *
 * NOTE: values are illustrative placeholders, not mission data.
 */
export const TARGETS = [
  {
    id: 'shackleton', body: 'moon', name: 'Shackleton Crater', region: 'Lunar south pole',
    lat: -89.9, lon: 0, tags: ['Water ice', 'Artemis region'],
    v: { temp: -190, ice: 80, soil: 55, terrain: 85, dry: 95, tube: 0 },
    soilDesc: 'Fine, glassy highland regolith',
    terrainDesc: 'Steep walls, permanent shadow',
    conf: 'Medium',
    goal: 'Mine water ice and test power and habitats near sunlit ridges. The crater is about 21 km wide and 4 km deep.',
    tp: { seed: 3, rough: .55, crater: 1.0 }
  },
  {
    id: 'marius', body: 'moon', name: 'Marius Hills Pit', region: 'Oceanus Procellarum, Moon',
    lat: 14.1, lon: -56.8, tags: ['Lava tube', 'Radiation shelter'],
    v: { temp: -20, ice: 5, soil: 95, terrain: 60, dry: 100, tube: 95 },
    soilDesc: 'Basaltic mare regolith',
    terrainDesc: 'Skylight pit into a possible tube',
    conf: 'Medium',
    goal: 'Check whether a lava tube can shelter a crew from radiation and from temperature swings.',
    tp: { seed: 7, rough: .3, pit: 1.1 }
  },
  {
    id: 'jezero', body: 'mars', name: 'Jezero Crater', region: 'Isidis Planitia, Mars',
    lat: 18.38, lon: 77.58, tags: ['Dry lakebed', 'Rover site'],
    v: { temp: -60, ice: 15, soil: 85, terrain: 45, dry: 95, tube: 0 },
    soilDesc: 'Basaltic sand, clays, carbonates',
    terrainDesc: 'Delta cliffs and boulder fields',
    conf: 'High',
    goal: 'Test rovers, drills and life-detection instruments on an ancient dry lake and river delta.',
    tp: { seed: 11, rough: .45, crater: .7, ripple: .5 }
  },
  {
    id: 'arsia', body: 'mars', name: 'Arsia Mons Skylights', region: 'Tharsis, Mars',
    lat: -8.3, lon: -120.1, tags: ['Lava tube', 'Cave shelter'],
    v: { temp: -65, ice: 10, soil: 90, terrain: 55, dry: 97, tube: 90 },
    soilDesc: 'Basaltic dust and rock',
    terrainDesc: 'Collapse pits on a volcano flank',
    conf: 'Low',
    goal: 'Assess cave entrances as shelters from radiation and dust storms.',
    tp: { seed: 19, rough: .5, pit: 1.0 }
  }
];
