/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{js,jsx,ts,tsx}', './public/index.html'],
  // The app toggles the `.theme-dark` class on <body>. This selector strategy
  // makes Tailwind's `dark:` variants activate whenever `.theme-dark` is on an
  // ancestor, so the legacy `.theme-dark .bg-card{}` overrides in App.css and
  // new `dark:` utilities coexist without conflict.
  darkMode: ['selector', '.theme-dark'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Hanken Grotesk', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        display: ['Space Grotesk', 'Hanken Grotesk', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'monospace'],
      },
      colors: {
        bg: '#0a0d14',
        bg2: '#0e1220',
        surf: '#141a28',
        surf2: '#1a2233',
        raise: '#202a3e',
        line: '#232c40',
        line2: '#2f3a52',
        ink: '#eef1f8',
        muted: '#8b95ad',
        muted2: '#5d6781',
        surface: '#0a0d14',
        card: '#141a28',
        cardAlt: '#0e1220',
        border: '#232c40',
        primary: {
          DEFAULT: '#7c5cff',
          strong: '#5a3ff0',
          soft: '#9d86ff',
        },
        secondary: {
          DEFAULT: '#38d6e6',
          soft: 'rgba(56,214,230,.14)',
        },
        cyan: '#38d6e6',
        amber: '#ffb24d',
        green: '#36d39a',
        red: '#ff5d72',
        violet: '#9d86ff',
        status: {
          success: '#36d39a',
          warning: '#ffb24d',
          danger: '#ff5d72',
          info: '#38d6e6',
        },
        // Stage group colors (funnel / kanban grouping).
        stage: {
          topo: '#5a93ff',
          meio: '#a78bff',
          fundo: '#ffb24d',
          outros: '#7b87a3',
          recompra: '#36d39a',
        },
      },
      zIndex: {
        // Keep header above board sticky chrome (column titles use z-10).
        header: '30',
        dropdown: '35',
        overlay: '40',
        modal: '50',
        toast: '60',
      },
      boxShadow: {
        card: '0 1px 2px rgba(0,0,0,.25)',
        lift: '0 10px 22px rgba(0,0,0,.35)',
      },
    },
  },
  plugins: [],
};
