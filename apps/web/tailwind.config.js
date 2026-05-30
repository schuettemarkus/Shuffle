// Custom token system — do not ship default-looking Tailwind (per the spec).
// Tokens mirror packages/shared/src/brand.ts so the canvas/DOM scene and the
// Tailwind classes stay in lockstep.

/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: '#14101A',
        'bg-2': '#1A1422',
        surface: '#211A2B',
        'surface-2': '#2B2238',
        elevated: '#352A45',
        border: 'rgba(255,228,210,0.10)',
        'border-hi': 'rgba(255,228,210,0.18)',
        sunset: '#FF6A3D',
        'sunset-bright': '#FF7E4A',
        ember: '#FF8A4C',
        amber: '#FFB14E',
        rose: '#FF5C7A',
        'dusk-violet': '#7A4FA3',
        indigo: '#2C2552',
        felt: '#0E5C57',
        'felt-deep': '#093F3C',
        ink: '#FBF3EB',
        'ink-soft': '#D9CCD4',
        'ink-mute': '#9A8FA3',
        win: '#3FBE93',
        fold: '#E0556B',
      },
      fontFamily: {
        display: ['"Bricolage Grotesque"', 'system-ui', 'sans-serif'],
        body: ['"Hanken Grotesk"', 'system-ui', 'sans-serif'],
      },
      borderRadius: {
        brand: '18px',
      },
      boxShadow: {
        brand: '0 24px 60px -24px rgba(0,0,0,.7)',
        sunset: '0 16px 34px -8px rgba(255,106,61,.7)',
      },
      keyframes: {
        rise: {
          from: { opacity: '0', transform: 'translateY(16px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        flick: {
          '0%,100%': { transform: 'rotate(-4deg) scale(1)' },
          '50%': { transform: 'rotate(5deg) scale(1.14)' },
        },
        pulseSunset: {
          '0%,100%': { boxShadow: '0 0 0 0 rgba(255,106,61,.5)' },
          '50%': { boxShadow: '0 0 0 12px rgba(255,106,61,0)' },
        },
        reaction: {
          '0%': { opacity: '0', transform: 'translateY(24px) scale(.6)' },
          '20%': { opacity: '1', transform: 'translateY(0) scale(1.15)' },
          '60%': { opacity: '1', transform: 'translateY(-12px) scale(1)' },
          '100%': { opacity: '0', transform: 'translateY(-48px) scale(.9)' },
        },
      },
      animation: {
        rise: 'rise .7s ease-out forwards',
        flick: 'flick 1.6s infinite',
        pulseSunset: 'pulseSunset 1.6s ease-in-out infinite',
        reaction: 'reaction 1.8s ease-out forwards',
      },
    },
  },
  plugins: [],
};
