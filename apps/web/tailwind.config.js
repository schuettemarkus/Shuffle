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
        flashWin: {
          '0%': { background: 'rgba(63,190,147,0)', transform: 'scale(1)' },
          '20%': { background: 'rgba(63,190,147,.28)', transform: 'scale(1.025)' },
          '100%': { background: 'rgba(63,190,147,0)', transform: 'scale(1)' },
        },
        flashLose: {
          '0%': { background: 'rgba(224,85,107,0)', transform: 'translateX(0)' },
          '15%': { background: 'rgba(224,85,107,.22)', transform: 'translateX(-3px)' },
          '30%': { transform: 'translateX(3px)' },
          '50%': { transform: 'translateX(-2px)' },
          '70%': { transform: 'translateX(0)' },
          '100%': { background: 'rgba(224,85,107,0)' },
        },
        flashPush: {
          '0%': { background: 'rgba(154,143,163,0)' },
          '30%': { background: 'rgba(154,143,163,.18)' },
          '100%': { background: 'rgba(154,143,163,0)' },
        },
        flashRibbon: {
          '0%': { opacity: '0', transform: 'translateY(6px) scale(.85)' },
          '20%': { opacity: '1', transform: 'translateY(-2px) scale(1.05)' },
          '70%': { opacity: '1', transform: 'translateY(-6px) scale(1)' },
          '100%': { opacity: '0', transform: 'translateY(-14px) scale(.95)' },
        },
        dealerSpin: {
          '0%': { transform: 'rotate(-30deg) scale(.6)', opacity: '0' },
          '60%': { transform: 'rotate(15deg) scale(1.12)', opacity: '1' },
          '100%': { transform: 'rotate(0) scale(1)', opacity: '1' },
        },
        speakingPulse: {
          '0%,100%': { transform: 'scale(1)' },
          '50%': { transform: 'scale(1.015)' },
        },
        // Card deal — drops in from above with a slight rotation.
        cardDeal: {
          '0%': { opacity: '0', transform: 'translate(-30px,-60px) rotate(-14deg) scale(.85)' },
          '60%': { opacity: '1', transform: 'translate(0,8px) rotate(2deg) scale(1.02)' },
          '100%': { opacity: '1', transform: 'translate(0,0) rotate(0) scale(1)' },
        },
        // Dealer hole-card reveal — a 3D flip.
        cardFlip: {
          '0%': { transform: 'rotateY(180deg)' },
          '100%': { transform: 'rotateY(0deg)' },
        },
        // Pot pulse when chips grow.
        potPulse: {
          '0%,100%': { transform: 'scale(1)', filter: 'brightness(1)' },
          '50%': { transform: 'scale(1.06)', filter: 'brightness(1.15)' },
        },
        // Dice settle — used after the tumble keyframe.
        diceLand: {
          '0%': { transform: 'translateY(-12px) scale(1.08) rotate(2deg)' },
          '60%': { transform: 'translateY(2px) scale(.96) rotate(-1deg)' },
          '100%': { transform: 'translateY(0) scale(1) rotate(0)' },
        },
      },
      animation: {
        rise: 'rise .7s ease-out forwards',
        flick: 'flick 1.6s infinite',
        pulseSunset: 'pulseSunset 1.6s ease-in-out infinite',
        reaction: 'reaction 1.8s ease-out forwards',
        flashWin: 'flashWin 1.5s ease-out forwards',
        flashLose: 'flashLose 1.4s ease-out forwards',
        flashPush: 'flashPush 1.5s ease-out forwards',
        flashRibbon: 'flashRibbon 1.6s ease-out forwards',
        dealerSpin: 'dealerSpin .6s cubic-bezier(.34,1.56,.64,1) backwards',
        speakingPulse: 'speakingPulse 1.4s ease-in-out infinite',
        cardDeal: 'cardDeal .55s cubic-bezier(.34,1.56,.64,1) backwards',
        cardFlip: 'cardFlip .55s cubic-bezier(.4,1.3,.5,1) both',
        potPulse: 'potPulse .65s ease-out',
        diceLand: 'diceLand .45s cubic-bezier(.34,1.6,.5,1) .55s backwards',
      },
    },
  },
  plugins: [],
};
