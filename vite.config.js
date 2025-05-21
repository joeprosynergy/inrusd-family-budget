import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    outDir: 'public', // Output directory for Netlify
    assetsDir: 'assets', // Subdirectory for CSS
    rollupOptions: {
      input: {
        main: 'src/js/index.js', // JavaScript entry point
        tailwind: 'src/css/tailwind.css' // Tailwind CSS entry point
      },
      output: {
        entryFileNames: '[name].js', // Output JS as main.js
        assetFileNames: 'assets/[name].[ext]' // Output CSS to assets/tailwind.css
      }
    },
    sourcemap: true // Helps with debugging
  },
  publicDir: false, // Disable publicDir to avoid overlap with outDir
  envPrefix: 'VITE_', // For Firebase config variables
  base: '/' // Base URL for Netlify
});
