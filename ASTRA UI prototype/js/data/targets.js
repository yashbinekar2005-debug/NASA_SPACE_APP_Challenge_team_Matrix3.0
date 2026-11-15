/**
 * Supported, literature-backed target profiles a user may choose from.
 * The application deliberately has no default selected target; choosing a
 * profile is an explicit user action. Coordinates here identify the measured
 * published target and are what the planetary model pins.
 *
 * These are no longer placeholders. Each value is a published measurement or a
 * clearly labelled proxy, with its uncertainty and source. `v` keeps the same
 * shape the engine already understands: a number or a measurement object
 * `{ value, uncertainty, source, ... }`.
 *
 * `ice`, `soil` and `terrain` remain 0–100 proxies because no single published
 * number is equivalent to the Earth-side index. Their definitions match
 * docs/data_dictionary.md.
 *
 * `conf` is documentation quality, not similarity.
 */

const SRC = {
  diviner: {
    name: 'LRO Diviner / Paige et al. 2010, Science 330, 479–482',
    url: 'https://doi.org/10.1126/science.1187726'
  },
  williams: {
    name: 'Williams et al., Diviner polar temperature maps (LRO)',
    url: 'https://www.diviner.ucla.edu/science'
  },
  lcross: {
    name: 'LCROSS / Colaprete et al. 2010, Science 330, 463–468',
    url: 'https://doi.org/10.1126/science.1186986'
  },
  horvath: {
    name: 'Horvath et al. 2022, GRL 49, e2022GL099710 (lunar pits and caves)',
    url: 'https://doi.org/10.1029/2022GL099710'
  },
  meda: {
    name: 'MEDA / Munguira et al. 2024, JGR Planets (one Martian year at Jezero)',
    url: 'https://doi.org/10.1029/2024JE008385'
  },
  cushing: {
    name: 'Cushing et al. 2007, GRL 34, L17201 (Arsia Mons skylights)',
    url: 'https://doi.org/10.1029/2007GL030709'
  },
  mcd: {
    name: 'Mars Climate Database v6 / THEMIS climatology',
    url: 'https://www-mars.lmd.jussieu.fr/mcd_python/'
  }
};

export const TARGETS = [
  {
    id: 'shackleton',
    body: 'moon',
    name: 'Shackleton Crater',
    region: 'Lunar south pole',
    lat: -89.9,
    lon: 0,
    tags: ['Water ice', 'Artemis region'],
    v: {
      temp: {
        value: -183,
        uncertainty: 18,
        source: SRC.diviner,
        measurementType: 'annual_mean_psr_surface_temperature',
        note: 'Average PSR temperature ≈ 90 K; winter ≈ 54 K, summer ≈ 90 K. The value is the summer mean used for design.'
      },
      solar: {
        value: 0,
        uncertainty: 0.05,
        source: SRC.williams,
        measurementType: 'annual_mean_surface_shortwave',
        note: 'Crater floor is in permanent shadow; surrounding ridges receive near-continuous sunlight and are not represented by this single value.'
      },
      ice: {
        value: 80,
        evidenceClass: 2,
        uncertainty: 0.2,
        evidenceClassUncertainty: 0.4,
        source: SRC.lcross,
        measurementType: 'water_ice_evidence',
        note: 'Strong hydrogen/volatile evidence and LCROSS water in the south polar region; exposed ice at this exact cell is not confirmed, so class 2 rather than 3.'
      },
      soil: {
        value: 55,
        uncertainty: 15,
        source: SRC.diviner,
        measurementType: 'mafic_soil_proxy',
        note: 'Fine, glassy highland regolith; not a mare basalt.'
      },
      terrain: {
        value: 85,
        uncertainty: 10,
        source: SRC.williams,
        measurementType: 'local_relief_proxy',
        note: 'Steep crater walls, ~21 km diameter and ~4 km deep.'
      },
      dry: {
        value: 100,
        uncertainty: 0,
        source: SRC.diviner,
        measurementType: 'vacuum_reference',
        note: 'Vacuum; no atmospheric humidity.'
      },
      tube: {
        value: 0,
        uncertainty: 0,
        source: SRC.diviner,
        measurementType: 'cave_access_capability',
        note: 'No mapped lava tube or pit at this target.'
      }
    },
    soilDesc: 'Fine, glassy highland regolith',
    terrainDesc: 'Steep walls, permanent shadow',
    conf: 'High',
    goal: 'Mine water ice and test power and habitats near sunlit ridges. The crater is about 21 km wide and 4 km deep.',
    tp: { seed: 3, rough: 0.55, crater: 1.0 }
  },
  {
    id: 'marius',
    body: 'moon',
    name: 'Marius Hills Pit',
    region: 'Oceanus Procellarum, Moon',
    lat: 14.1,
    lon: -56.8,
    tags: ['Lava tube', 'Radiation shelter'],
    v: {
      temp: {
        value: -23,
        uncertainty: 10,
        source: SRC.horvath,
        measurementType: 'regional_mean_surface_temperature',
        note: 'Equatorial mean surface ≈ 250 K. The shaded pit/cave interior is modelled near 290 K (17 °C) and is a different environment.'
      },
      solar: {
        value: 10.4,
        uncertainty: 1,
        source: SRC.diviner,
        measurementType: 'annual_mean_surface_shortwave',
        note: 'Geometric mean of the lunar day at low latitude, 1361 W/m² incident, no atmosphere.'
      },
      ice: {
        value: 5,
        evidenceClass: 0,
        uncertainty: 0.2,
        evidenceClassUncertainty: 0.4,
        source: SRC.horvath,
        measurementType: 'water_ice_evidence',
        note: 'No strong volatile evidence at this equatorial pit; caves near the pole are more relevant for cold trapping.'
      },
      soil: {
        value: 95,
        uncertainty: 10,
        source: SRC.horvath,
        measurementType: 'mafic_soil_proxy',
        note: 'Mare basalt and basaltic regolith.'
      },
      terrain: {
        value: 60,
        uncertainty: 12,
        source: SRC.horvath,
        measurementType: 'local_relief_proxy',
        note: 'Pit and sinuous rille in mare terrain.'
      },
      dry: {
        value: 100,
        uncertainty: 0,
        source: SRC.horvath,
        measurementType: 'vacuum_reference',
        note: 'Vacuum.'
      },
      tube: {
        value: 95,
        uncertainty: 5,
        source: SRC.horvath,
        measurementType: 'cave_access_capability',
        note: 'GRAIL and LRS evidence for a lava tube associated with the Marius Hills pit.'
      }
    },
    soilDesc: 'Basaltic mare regolith',
    terrainDesc: 'Skylight pit into a probable lava tube',
    conf: 'High',
    goal: 'Check whether a lava tube can shelter a crew from radiation and from temperature swings.',
    tp: { seed: 7, rough: 0.3, pit: 1.1 }
  },
  {
    id: 'jezero',
    body: 'mars',
    name: 'Jezero Crater',
    region: 'Isidis Planitia, Mars',
    lat: 18.38,
    lon: 77.58,
    tags: ['Dry lakebed', 'Rover site'],
    v: {
      temp: {
        value: -52,
        uncertainty: 5,
        source: SRC.meda,
        measurementType: 'annual_mean_surface_temperature',
        note: 'MEDA daily mean surface temperature ranged 210–232 K (≈ −63 to −41 °C) over one Martian year; annual mean ≈ 221 K.'
      },
      solar: {
        value: 3.6,
        uncertainty: 0.6,
        source: SRC.meda,
        measurementType: 'annual_mean_surface_shortwave',
        note: 'Surface insolation after atmospheric attenuation and dust; Mars solar constant ≈ 590 W/m² at this distance.'
      },
      ice: {
        value: 15,
        evidenceClass: 1,
        uncertainty: 0.2,
        evidenceClassUncertainty: 0.4,
        source: SRC.meda,
        measurementType: 'water_ice_evidence',
        note: 'Hydrated minerals and ancient aqueous alteration; not present-day ground ice at the equatorial landing site.'
      },
      soil: {
        value: 85,
        uncertainty: 12,
        source: SRC.meda,
        measurementType: 'mafic_soil_proxy',
        note: 'Basaltic sand with clays and carbonates in the delta and crater floor.'
      },
      terrain: {
        value: 45,
        uncertainty: 12,
        source: SRC.meda,
        measurementType: 'local_relief_proxy',
        note: 'Flat crater floor, delta cliffs and boulder fields.'
      },
      dry: {
        value: 95,
        uncertainty: 3,
        source: SRC.meda,
        measurementType: 'atmospheric_water_vapour_proxy',
        note: 'Very low atmospheric water vapour; no liquid surface water.'
      },
      tube: {
        value: 0,
        uncertainty: 0,
        source: SRC.meda,
        measurementType: 'cave_access_capability',
        note: 'No mapped cave entrance at the rover field site.'
      }
    },
    soilDesc: 'Basaltic sand, clays, carbonates',
    terrainDesc: 'Delta cliffs and boulder fields',
    conf: 'High',
    goal: 'Test rovers, drills and life-detection instruments on an ancient dry lake and river delta.',
    tp: { seed: 11, rough: 0.45, crater: 0.7, ripple: 0.5 }
  },
  {
    id: 'arsia',
    body: 'mars',
    name: 'Arsia Mons Skylights',
    region: 'Tharsis, Mars',
    lat: -8.3,
    lon: -120.1,
    tags: ['Lava tube', 'Cave shelter'],
    v: {
      temp: {
        value: -65,
        uncertainty: 10,
        source: SRC.mcd,
        measurementType: 'regional_mean_surface_temperature',
        note: 'High-altitude equatorial Tharsis surface; MCD/THEMIS climatology. Cave interiors are buffered and not modelled here.'
      },
      solar: {
        value: 3.4,
        uncertainty: 0.7,
        source: SRC.mcd,
        measurementType: 'annual_mean_surface_shortwave',
        note: 'Surface insolation at ~9°S and high elevation, after dust attenuation.'
      },
      ice: {
        value: 10,
        evidenceClass: 0,
        uncertainty: 0.2,
        evidenceClassUncertainty: 0.4,
        source: SRC.cushing,
        measurementType: 'water_ice_evidence',
        note: 'No strong surface ice evidence at the skylight field.'
      },
      soil: {
        value: 90,
        uncertainty: 15,
        source: SRC.cushing,
        measurementType: 'mafic_soil_proxy',
        note: 'Dust-covered basaltic lava flows on the Arsia Mons flank.'
      },
      terrain: {
        value: 55,
        uncertainty: 15,
        source: SRC.cushing,
        measurementType: 'local_relief_proxy',
        note: 'Pit craters and collapse skylights on a volcano flank.'
      },
      dry: {
        value: 97,
        uncertainty: 3,
        source: SRC.mcd,
        measurementType: 'atmospheric_water_vapour_proxy',
        note: 'Very low atmospheric water vapour.'
      },
      tube: {
        value: 90,
        uncertainty: 8,
        source: SRC.cushing,
        measurementType: 'cave_access_capability',
        note: 'Seven candidate cave skylights with thermal behaviour consistent with subsurface voids; not confirmed caves.'
      }
    },
    soilDesc: 'Basaltic dust and rock',
    terrainDesc: 'Collapse pits on a volcano flank',
    conf: 'Medium',
    goal: 'Assess cave entrances as shelters from radiation and dust storms.',
    tp: { seed: 19, rough: 0.5, pit: 1.0 }
  }
];

export const TARGET_SOURCE_REGISTRY = SRC;
