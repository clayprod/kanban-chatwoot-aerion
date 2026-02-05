/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{js,jsx,ts,tsx}', './public/index.html'],
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
          DEFAULT: '#2563eb',
          strong: '#1d4ed8',
          soft: '#dbeafe',
        },
        secondary: {
          DEFAULT: '#4f46e5',
          soft: '#e0e7ff',
        },
        status: {
          success: '#16a34a',
          warning: '#f59e0b',
          danger: '#ef4444',
          info: '#0ea5e9',
        },
      },
      boxShadow: {
        card: '0 1px 2px rgba(16, 24, 40, 0.06), 0 1px 3px rgba(16, 24, 40, 0.08)',
        lift: '0 6px 18px rgba(16, 24, 40, 0.12)',
      },
    },
  },
  plugins: [],
};
