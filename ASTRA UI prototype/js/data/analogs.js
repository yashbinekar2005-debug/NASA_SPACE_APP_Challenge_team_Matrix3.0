/**
 * Earth analog sites: real places used by space agencies for field tests.
 *
 * `why`  — why the site matters for lunar/Mars analogue work
 * `conf` — confidence in how well the site is documented
 * `tp`   — parameters for the procedural terrain preview
 *
 * The numeric indexes are placeholders for a design prototype.
 */
export const ANALOGS = [
  {
    id: 'askja', name: 'Askja', region: 'Highlands, Iceland', lat: 65.03, lon: -16.75,
    v: { temp: -2, ice: 70, soil: 90, terrain: 70, dry: 40, tube: 25 }, conf: 'Medium',
    soilDesc: 'Basalt sand and ash', terrainDesc: 'Caldera walls and lava fields',
    why: 'A basaltic caldera with snow, ice and rough volcanic ground. Astronauts trained here for lunar geology.',
    tp: { seed: 5, rough: .6, crater: .7 }
  },
  {
    id: 'atacama', name: 'Atacama Desert', region: 'Antofagasta, Chile', lat: -24.5, lon: -69.25,
    v: { temp: 15, ice: 3, soil: 80, terrain: 35, dry: 98, tube: 0 }, conf: 'High',
    soilDesc: 'Salty silicate sand', terrainDesc: 'Flat plains and dune fields',
    why: 'One of the driest places outside the poles. Used to test Mars rover drills and life-detection sensors.',
    tp: { seed: 21, rough: .25, ripple: 1.0 }
  },
  {
    id: 'kilauea', name: 'Kīlauea', region: 'Hawaiʻi Island, USA', lat: 19.42, lon: -155.29,
    v: { temp: 18, ice: 2, soil: 98, terrain: 55, dry: 20, tube: 92 }, conf: 'High',
    soilDesc: 'Fresh basalt and ash', terrainDesc: 'Lava fields, skylights, tubes',
    why: 'Fresh basalt with lava tubes you can walk into. A stand-in for tubes on the Moon and Mars.',
    tp: { seed: 8, rough: .5, pit: .6 }
  },
  {
    id: 'maunakea', name: 'Mauna Kea', region: 'Hawaiʻi Island, USA', lat: 19.82, lon: -155.47,
    v: { temp: 3, ice: 15, soil: 95, terrain: 50, dry: 65, tube: 30 }, conf: 'Medium',
    soilDesc: 'Basaltic cinder', terrainDesc: 'Cinder cones, cold high desert',
    why: 'Volcanic cinder close to lunar soil. Used for field tests of equipment that digs and processes regolith.',
    tp: { seed: 31, rough: .6, crater: .3 }
  },
  {
    id: 'devon', name: 'Devon Island', region: 'Nunavut, Canada', lat: 75.4, lon: -89.8,
    v: { temp: -16, ice: 85, soil: 60, terrain: 55, dry: 85, tube: 0 }, conf: 'High',
    soilDesc: 'Impact breccia, carbonate rock', terrainDesc: 'Impact crater on permafrost',
    why: 'A polar desert with an impact crater and ground ice. Rovers and spacesuits are tested here.',
    tp: { seed: 12, rough: .4, crater: .9 }
  },
  {
    id: 'dryvalleys', name: 'McMurdo Dry Valleys', region: 'Antarctica', lat: -77.5, lon: 162.5,
    v: { temp: -20, ice: 70, soil: 70, terrain: 50, dry: 99, tube: 0 }, conf: 'Medium',
    soilDesc: 'Sandy glacial till', terrainDesc: 'Rocky valleys, ice-cemented ground',
    why: 'Cold, dry and windy with ground ice. Among the closest Earth matches for parts of Mars.',
    tp: { seed: 44, rough: .7, ripple: .3 }
  },
  {
    id: 'lanzarote', name: 'Lanzarote Lava Tubes', region: 'Canary Islands, Spain', lat: 29.05, lon: -13.45,
    v: { temp: 21, ice: 0, soil: 92, terrain: 45, dry: 70, tube: 88 }, conf: 'Medium',
    soilDesc: 'Basalt and volcanic ash', terrainDesc: 'Lava fields, collapsed tube sections',
    why: 'Long, well-studied lava tubes. Space agencies use them to train astronauts for cave exploration.',
    tp: { seed: 15, rough: .5, pit: .7 }
  },
  {
    id: 'riotinto', name: 'Río Tinto', region: 'Andalusia, Spain', lat: 37.7, lon: -6.55,
    v: { temp: 17, ice: 2, soil: 55, terrain: 30, dry: 55, tube: 5 }, conf: 'Medium',
    soilDesc: 'Iron and sulfate minerals', terrainDesc: 'Open pits and river banks',
    why: 'An acidic, iron-rich river. Used for drilling and life-detection tests that mimic Mars minerals.',
    tp: { seed: 27, rough: .5, ripple: .2 }
  },
  {
    id: 'danakil', name: 'Danakil Depression', region: 'Afar, Ethiopia', lat: 14.24, lon: 40.3,
    v: { temp: 35, ice: 0, soil: 70, terrain: 30, dry: 95, tube: 15 }, conf: 'Low',
    soilDesc: 'Basalt and salt crust', terrainDesc: 'Salt flats and lava fields',
    why: 'A hot volcanic basin with salt flats and hydrothermal pools, studied for Mars-like chemistry.',
    tp: { seed: 36, rough: .35, crater: .3, ripple: .6 }
  },
  {
    id: 'mdrs', name: 'Mars Desert Research Station', region: 'Utah, USA', lat: 38.41, lon: -110.79,
    v: { temp: 12, ice: 0, soil: 60, terrain: 40, dry: 88, tube: 0 }, conf: 'Medium',
    soilDesc: 'Clay-rich sandstone and shale', terrainDesc: 'Badlands and dry washes',
    why: 'A red desert where crews practice living and working in a simulated Mars habitat.',
    tp: { seed: 50, rough: .45, ripple: .4 }
  }
];
