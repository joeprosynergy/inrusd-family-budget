import { defineConfig } from 'vite';

export default defineConfig({
  // Build configuration
  build: {
    outDir: 'public', // Output directory for Netlify
    assetsDir: 'assets', // Subdirectory for assets (e.g., images, if any)
    rollupOptions: {
      input: 'src/js/index.js' // Entry point for bundling
    },
    sourcemap: true // Generate sourcemaps for debugging
  },
  // Environment variable configuration
  envPrefix: 'VITE_', // Prefix for environment variables (e.g., VITE_FIREBASE_API_KEY)
  // Base URL for assets (root for Netlify)
  base: '/'
});
