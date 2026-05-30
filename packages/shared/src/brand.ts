// Shuffle — sunset-lounge brand tokens.
// Sourced from shuffle-brand-board.html. Keep these in sync if either drifts.

export const brand = {
  name: 'Shuffle',
  tagline: 'A warm corner of the internet where friends pull up a chair.',

  color: {
    // Sunset ramp — hero accent. Reserved for the single most important action.
    sunset: '#FF6A3D',
    sunsetBright: '#FF7E4A',
    ember: '#FF8A4C',
    amber: '#FFB14E',
    rose: '#FF5C7A',
    duskViolet: '#7A4FA3',
    indigo: '#2C2552',

    // Surfaces — deep warm dusk.
    bg: '#14101A',
    bg2: '#1A1422',
    surface: '#211A2B',
    surface2: '#2B2238',
    elevated: '#352A45',
    border: 'rgba(255,228,210,0.10)',
    borderHi: 'rgba(255,228,210,0.18)',

    // Felt — teal complement.
    felt: '#0E5C57',
    feltDeep: '#093F3C',

    // Text.
    ink: '#FBF3EB',
    inkSoft: '#D9CCD4',
    inkMute: '#9A8FA3',

    // Functional.
    confirm: '#FF6A3D',
    win: '#3FBE93',
    fold: '#E0556B',

    // Heat Index hues.
    heatFireA: '#FF4D2E',
    heatFireB: '#FF9D3D',
    heatBuzz: '#FFB14E',
    heatCruise: '#2BB89E',
    heatCold: '#5BC7E6',
    heatGrave: '#8A8194',
    heatCoaster: '#FF5C9E',
    heatWhale: '#46A0E6',
    heatHeater: '#FFCB52',
  },

  font: {
    display: '"Bricolage Grotesque", system-ui, sans-serif',
    body: '"Hanken Grotesk", system-ui, sans-serif',
  },

  radius: '18px',
  shadow: '0 24px 60px -24px rgba(0,0,0,.7)',
} as const;

export type Brand = typeof brand;
