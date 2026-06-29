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
        sans: ['Manrope', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
      colors: {
        ink: '#0f172a',
        muted: '#667085',
        surface: '#f5f7fb',
        card: '#ffffff',
        cardAlt: '#f7f8fb',
        border: '#e5e7eb',
        primary: {
          DEFAULT: '#6366f1',
          strong: '#4f46e5',
          soft: '#e0e7ff',
        },
        secondary: {
          DEFAULT: '#8b5cf6',
          soft: '#ede9fe',
        },
        violet: '#a855f7',
        status: {
          success: '#16a34a',
          warning: '#f59e0b',
          danger: '#ef4444',
          info: '#0ea5e9',
        },
        // Stage group colors (funnel / kanban grouping).
        stage: {
          topo: '#3B82F6',
          meio: '#8B5CF6',
          fundo: '#F59E0B',
          outros: '#6B7280',
          recompra: '#10B981',
        },
      },
      zIndex: {
        header: '10',
        dropdown: '20',
        overlay: '40',
        modal: '50',
        toast: '60',
      },
      boxShadow: {
        card: '0 1px 2px rgba(16, 24, 40, 0.06), 0 1px 3px rgba(16, 24, 40, 0.08)',
        lift: '0 6px 18px rgba(16, 24, 40, 0.12)',
      },
    },
  },
  plugins: [],
};
