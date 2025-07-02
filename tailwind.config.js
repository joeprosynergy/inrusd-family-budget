/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./src/**/*.{html,js}",
    "./src/index.html"
  ],
  theme: {
    extend: {},
  },
  plugins: [],
  corePlugins: {
    // Disable unused core plugins to reduce bundle size
    preflight: true,
  }
}
