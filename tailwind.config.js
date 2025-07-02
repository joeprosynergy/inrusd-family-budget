/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './src/**/*.{html,js}',
    './index.html'
  ],
  theme: {
    extend: {}
  },
  plugins: [],
  purge: {
    enabled: process.env.NODE_ENV === 'production',
    content: ['./src/**/*.{html,js}', './index.html']
  }
};
