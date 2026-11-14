/**
 * The seven scoring dimensions shared by the UI and the similarity engine.
 *
 * `temp` (°C) and `solar` (kWh/m²/day) are real physical values. The other
 * five are documented 0–100 evidence/condition indexes because no single
 * published quantity is equivalent across Earth, Moon and Mars.
 *
 * Metadata drives:
 *   - how a value becomes a bounded distance (`kind`, `distanceCap`, `scale`);
 *   - how comparable the measurement really is across bodies (`comparability`);
 *   - whether the feature is a direct measurement, a proxy, or a capability.
 *
 * `comparability` is a 0–1 trust weight used only for confidence, never for
 * similarity. It is deliberately conservative: 1 would mean the same quantity
 * is measured the same way on all three bodies.
 */
export const FACTORS = [
  {
    k: 'temp',
    label: 'Temperature',
    hint: 'Mean surface temperature',
    kind: 'continuous',
    unit: '°C',
    family: 'thermal',
    distanceCap: 200,
    comparability: 0.7,
    evidenceType: 'measurement',
    comparabilityNote:
      'Annual mean surface/skin temperature. Earth MERRA-2 skin temperature, lunar Diviner ' +
      'surface temperature and Mars MEDA surface temperature are related but not identical measurements.'
  },
  {
    k: 'solar',
    label: 'Solar illumination',
    hint: 'Surface shortwave irradiance',
    kind: 'continuous',
    unit: 'kWh/m²/day',
    family: 'thermal',
    distanceCap: 12,
    comparability: 0.6,
    evidenceType: 'measurement',
    comparabilityNote:
      'Annual mean surface shortwave irradiance. Earth values include clouds and atmosphere; ' +
      'lunar and Martian values are surface estimates from published measurements, not the same instrument.'
  },
  {
    k: 'ice',
    label: 'Ice and water',
    hint: 'Ice or water evidence in the ground',
    kind: 'index',
    unit: 'index',
    scale: 100,
    family: 'water_volatile',
    comparability: 0.5,
    evidenceType: 'proxy',
    comparabilityNote:
      'A 0–100 evidence index, not a water fraction. Earth snow/soil moisture, Martian hydrated ' +
      'minerals and lunar hydrogen/neutron evidence are different quantities; where both sides ' +
      'expose an ordered evidence class the engine compares classes instead of raw indexes.'
  },
  {
    k: 'soil',
    label: 'Volcanic soil',
    hint: 'How mafic/basalt-like the ground is',
    kind: 'index',
    unit: 'index',
    scale: 100,
    family: 'geological',
    comparability: 0.7,
    evidenceType: 'proxy',
    comparabilityNote:
      'A 0–100 composition proxy from mapped lithology and sand fraction. Different instruments, ' +
      'depths and spatial scales mean this is a regional resemblance indicator, not a mineralogical equivalence.'
  },
  {
    k: 'terrain',
    label: 'Terrain roughness',
    hint: 'Local relief and ruggedness',
    kind: 'index',
    unit: 'index',
    scale: 100,
    family: 'terrain',
    comparability: 0.85,
    evidenceType: 'proxy',
    comparabilityNote:
      'A 0–100 relief index from a stated 3×3 SRTM sample. It compares terrain character at a ' +
      'regional window, not raw pixels from different sensors.'
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
      'A 0–100 aridity proxy from precipitation and relative humidity. Earth atmospheric/soil ' +
      'aridity is not the same quantity as Martian or lunar surface dryness.'
  },
  {
    k: 'tube',
    label: 'Lava-tube access',
    hint: 'Mapped cave or tube entrances',
    kind: 'capability',
    unit: 'index',
    scale: 100,
    applicabilityThreshold: 50,
    family: 'geological',
    comparability: 0.8,
    evidenceType: 'capability',
    comparabilityNote:
      'A capability score, not a distance. It only applies when the selected target has a mapped ' +
      'tube or pit, and it is reported as a capability proxy, not a surveyed cave.'
  }
];
