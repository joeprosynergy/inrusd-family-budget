import { defineConfig } from 'vite';

export default defineConfig({
  root: 'src', // Root is src/ where index.html resides
  build: {
    outDir: '../public', // Output to public/ relative to src/
    assetsDir: 'assets', // Subdirectory for CSS
    rollupOptions: {
      input: {
        index: 'src/index.html', // HTML entry point
        js: 'src/js/index.js', // JavaScript entry point
        tailwind: 'src/css/tailwind.css' // Tailwind CSS entry point
      },
      output: {
        entryFileNames: '[name].js', // Output JS as index.js
        assetFileNames: 'assets/[name].[ext]' // Output CSS to assets/tailwind.css
      }
    },
    sourcemap: true // Generate sourcemaps
  },
  publicDir: false, // Disable publicDir to avoid overlap
  envPrefix: 'VITE_', // For Firebase config variables
  base: '/' // Base URL for Netlify
});
