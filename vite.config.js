import { defineConfig } from 'vite';

export default defineConfig({
  root: 'src', // Root is src/ where index.html resides
  build: {
    outDir: '../public', // Output to public/ relative to src/
    assetsDir: 'assets', // Subdirectory for CSS
    rollupOptions: {
      input: {
        js: 'src/js/index.js', // JavaScript entry point, outputs js.js
        tailwind: 'src/tailwind.css', // Tailwind CSS entry point
        index: 'src/index.html' // HTML entry point
      },
      output: {
        entryFileNames: '[name].js', // Output JS as js.js
        assetFileNames: 'assets/[name].[ext]' // Output CSS to assets/tailwind.css
      }
    },
    sourcemap: true, // Generate sourcemaps
    cssMinify: true // Minify CSS in production
  },
  publicDir: false, // Disable publicDir to avoid overlap
  envPrefix: 'VITE_', // For Firebase config variables
  base: '/' // Base URL for Netlify
});
