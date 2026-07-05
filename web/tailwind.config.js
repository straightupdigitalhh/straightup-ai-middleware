/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // straightup CI (extrahiert von straightup-digital.de)
        brand: {
          mint: '#98FB98',
          green: '#3DC372',
          coral: '#E44E56',
          ink: '#212121',
        },
      },
      fontFamily: {
        heading: ['"Lexend Deca"', 'sans-serif'],
        body: ['Inter', 'sans-serif'],
      },
      borderRadius: {
        pill: '40px',
      },
    },
  },
  plugins: [],
};
