/**
 * The six scoring dimensions shared by the UI and the similarity engine.
 *
 * `temp` is a real value in °C. Every other factor is a documented 0–100
 * evidence/condition index. These are still prototype values, but the
 * metadata below is what the engine uses to decide:
 *   - how a value becomes a bounded distance (`kind`, `distanceCap`, `scale`);
 *   - how comparable the measurement really is across bodies (`comparability`);
 *   - whether the feature is a direct measurement, a proxy, or a capability.
 *
 * `comparability` is a 0–1 trust weight used only for confidence, never for
 * similarity. It is deliberately conservative: a value of 1 would mean the
 * same quantity is measured the same way on Earth, the Moon and Mars.
 */
export const FACTORS = [
  {
    k: 'temp',
    label: 'Temperature',
    hint: 'Average surface temperature',
    kind: 'continuous',
    unit: '°C',
    family: 'thermal',
    distanceCap: 200,
    comparability: 0.7,
    evidenceType: 'measurement',
    comparabilityNote:
      'Regional mean surface temperature. Earth land-surface temperature and planetary ' +
      'surface/atmospheric temperatures are related, but they are not identical measurements.'
  },
  {
    k: 'ice',
    label: 'Ice and water',
    hint: 'Ice or water in the ground',
    kind: 'index',
    unit: 'index',
    scale: 100,
    family: 'water_volatile',
    comparability: 0.5,
    evidenceType: 'proxy',
    comparabilityNote:
      'A 0–100 evidence index, not a water fraction. Earth ice/soil moisture, Martian ' +
      'ice/hydrated-mineral evidence and lunar hydrogen/neutron evidence are different quantities.'
  },
  {
    k: 'soil',
    label: 'Volcanic soil',
    hint: 'How basalt-like the soil is',
    kind: 'index',
    unit: 'index',
    scale: 100,
    family: 'geological',
    comparability: 0.7,
    evidenceType: 'proxy',
    comparabilityNote:
      'A 0–100 composition proxy. Different instruments and spatial scales mean this is a ' +
      'regional resemblance indicator, not a mineralogical equivalence.'
  },
  {
    k: 'terrain',
    label: 'Terrain roughness',
    hint: 'Slopes and rock roughness',
    kind: 'index',
    unit: 'index',
    scale: 100,
    family: 'terrain',
    comparability: 0.85,
    evidenceType: 'proxy',
    comparabilityNote:
      'A 0–100 roughness/ruggedness index derived at a stated regional window. It compares ' +
      'terrain character, not raw pixels from different sensors.'
  },
  {
    k: 'dry',
    label: 'Dryness',
    hint: 'Very dry air and ground',
    kind: 'index',
    unit: 'index',
    scale: 100,
    family: 'water_volatile',
    comparability: 0.6,
    evidenceType: 'proxy',
    comparabilityNote:
      'A 0–100 aridity proxy. Earth atmospheric/soil aridity is not the same quantity as ' +
      'Martian or lunar surface dryness, so this is used only in the water/volatile profile.'
  },
  {
    k: 'tube',
    label: 'Lava-tube access',
    hint: 'Lava tube or cave entrances',
    kind: 'capability',
    unit: 'index',
    scale: 100,
    applicabilityThreshold: 50,
    family: 'geological',
    comparability: 0.8,
    evidenceType: 'capability',
    comparabilityNote:
      'A capability score, not a distance. It only applies when the selected target has a ' +
      'mapped tube or pit, and it is reported as such.'
  }
];
