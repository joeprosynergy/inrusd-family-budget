import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    outDir: 'public', // Output directory for Netlify
    assetsDir: 'assets', // Subdirectory for assets (e.g., CSS)
    rollupOptions: {
      input: {
        main: 'src/js/index.js', // JavaScript entry point
        tailwind: 'src/css/tailwind.css' // Tailwind CSS entry point
      },
      output: {
        entryFileNames: '[name].js', // Output JS as bundle.js
        assetFileNames: 'assets/[name].[ext]' // Output CSS to assets/tailwind.css
      }
    },
    sourcemap: true // Generate sourcemaps for debugging
  },
  envPrefix: 'VITE_', // Prefix for environment variables
  base: '/' // Base URL for Netlify
});
