/**
 * Planetary environments and the differences an Earth analog cannot remove.
 *
 * Values are published reference values, not site measurements. They are shown
 * alongside every comparison so a high similarity score is never mistaken for
 * a replicable environment.
 *
 * Sources:
 *   NASA Planetary Fact Sheet (nssdc.gsfc.nasa.gov/planetary/factsheet/)
 *   MSL RAD / Hassler et al. 2014, Science 343, 1244797
 *   UNSCEAR 2008, Sources and Effects of Ionizing Radiation
 *   Williams, D.R., Moon Fact Sheet; Mars Fact Sheet
 */

const EARTH = {
  gravity: 9.807,
  pressureKpa: 101.325,
  pressureLabel: '101.325 kPa',
  radiationMsvYear: 2.4,
  radiationRange: '≈2.4 mSv/yr at sea level (UNSCEAR)',
  magneticFieldUt: 50,
  dayLengthHours: 24,
  dayLengthLabel: '24 h',
  atmosphere: '78% N₂, 21% O₂, 1% Ar'
};

const BODIES = {
  moon: {
    name: 'Moon',
    gravity: 1.62,
    pressureKpa: 0,
    pressureLabel: 'vacuum (<10⁻¹² kPa)',
    radiationMsvYear: 300,
    radiationRange: '200–400 mSv/yr from galactic cosmic rays and solar particle events',
    magneticFieldUt: 0,
    dayLengthHours: 708.7,
    dayLengthLabel: '29.5 Earth days',
    atmosphere: 'effectively none',
    sources: [
      { name: 'NASA Moon Fact Sheet', url: 'https://nssdc.gsfc.nasa.gov/planetary/factsheet/moonfact.html' },
      { name: 'LRO/CRaTER and MSL RAD radiation environment literature', url: 'https://doi.org/10.1126/science.1244797' }
    ]
  },
  mars: {
    name: 'Mars',
    gravity: 3.71,
    pressureKpa: 0.636,
    pressureLabel: '0.636 kPa mean surface pressure',
    radiationMsvYear: 240,
    radiationRange: '≈240 mSv/yr at the surface (MSL RAD: 0.64 mGy/day)',
    magneticFieldUt: 0,
    dayLengthHours: 24.66,
    dayLengthLabel: '24 h 39 m',
    atmosphere: '95% CO₂, 2.8% N₂, 2% Ar',
    sources: [
      { name: 'NASA Mars Fact Sheet', url: 'https://nssdc.gsfc.nasa.gov/planetary/factsheet/marsfact.html' },
      { name: 'Hassler et al. 2014, Mars surface radiation environment', url: 'https://doi.org/10.1126/science.1244797' }
    ]
  }
};

const DEFINITIONS = [
  {
    key: 'gravity',
    label: 'Surface gravity',
    unit: 'm/s²',
    earth: EARTH.gravity,
    target: (body) => body.gravity,
    severity: 'fundamental',
    why: 'Gravity is set by planetary mass. No Earth location can change it.',
    consequence:
      'Regolith settling, bearing capacity, rover traction, dust lift-off, fluid behaviour and human physiology all differ. A field test at 1 g cannot validate a 1/6 g or 3/8 g design.',
    mitigation: 'Partial-gravity aircraft flights and centrifuges test short transients, not long-duration surface processes.'
  },
  {
    key: 'pressure',
    label: 'Atmospheric pressure',
    unit: 'kPa',
    display: (body) => body.pressureLabel,
    earth: EARTH.pressureKpa,
    target: (body) => body.pressureKpa,
    severity: 'fundamental',
    why: 'The Moon has no atmosphere; Mars has a thin CO₂ atmosphere. Earth has a thick N₂/O₂ atmosphere.',
    consequence:
      'Dust transport, convection, evaporation, acoustic propagation, thermal coupling and EVA suit loads are not scalable from Earth data.',
    mitigation: 'Vacuum chambers and Mars-pressure test beds reproduce pressure but not scale or the full environment.'
  },
  {
    key: 'radiation',
    label: 'Radiation exposure',
    unit: 'mSv/yr',
    display: (body) => body.radiationRange,
    earth: EARTH.radiationMsvYear,
    target: (body) => body.radiationMsvYear,
    severity: 'fundamental',
    why: 'Earth’s atmosphere and magnetic field shield the surface. The Moon and Mars have no global magnetic shield and little or no atmosphere.',
    consequence:
      'Surface GCR and solar particle doses are roughly 100× Earth sea level. Electronics, biology and habitat shielding cannot be validated by an unshielded Earth field site.',
    mitigation: 'Shielding and cave/tube shelter can reduce dose; the radiation field itself is not reproduced.'
  },
  {
    key: 'magnetic_field',
    label: 'Global magnetic field',
    unit: 'µT',
    earth: EARTH.magneticFieldUt,
    target: (body) => body.magneticFieldUt,
    severity: 'major',
    why: 'Earth has a dynamo-driven global field; the Moon has none and Mars has only crustal remnants.',
    consequence:
      'Compass navigation, plasma interactions and charged-particle shielding differ. A magnetic field is not an Earth surface property that can be selected for.',
    mitigation: 'Local shielding can replace some protection, but not the field environment.'
  },
  {
    key: 'day_length',
    label: 'Day–night cycle',
    unit: 'h',
    display: (body) => body.dayLengthLabel,
    earth: EARTH.dayLengthHours,
    target: (body) => body.dayLengthHours,
    severity: 'major',
    why: 'The Moon’s day is 29.5 Earth days; Mars is close to Earth but not identical.',
    consequence:
      'Thermal cycling, solar power storage, sleep cycles and operations planning differ. A 24-hour Earth site cannot reproduce a 14-day lunar night.',
    mitigation: 'Artificial lighting and power storage test some effects, not the real cycle.'
  },
  {
    key: 'atmosphere',
    label: 'Atmosphere composition',
    unit: '',
    display: (body) => body.atmosphere,
    earth: EARTH.atmosphere,
    target: (body) => body.atmosphere,
    severity: 'fundamental',
    why: 'Earth’s oxidising N₂/O₂ atmosphere is absent on the Moon and is CO₂-dominated on Mars.',
    consequence:
      'Material oxidation, dust cohesion, fire risk, acoustics and life-support assumptions are not transferable.',
    mitigation: 'Controlled-atmosphere chambers are required; an open-air Earth analog cannot test them.'
  }
];

export function environmentFor(body) {
  return BODIES[body] || null;
}

/** Return the non-replicable differences for a target body. */
export function nonReplicableFor(body) {
  const target = BODIES[body];
  if (!target) return [];
  return DEFINITIONS.map((definition) => {
    const targetValue = definition.target(target);
    const earthValue = definition.earth;
    return {
      key: definition.key,
      label: definition.label,
      unit: definition.unit,
      earth: earthValue,
      target: targetValue,
      earth_display: definition.display ? definition.display(EARTH) : earthValue,
      target_display: definition.display ? definition.display(target) : targetValue,
      ratio: Number.isFinite(earthValue) && earthValue !== 0 && Number.isFinite(targetValue)
        ? Math.round((targetValue / earthValue) * 1000) / 1000
        : null,
      replicable: false,
      severity: definition.severity,
      why: definition.why,
      consequence: definition.consequence,
      mitigation: definition.mitigation,
      sources: target.sources
    };
  });
}

export { EARTH, BODIES };
