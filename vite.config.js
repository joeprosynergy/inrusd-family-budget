import { defineConfig } from 'vite';

export default defineConfig({
  root: 'src', // Root is src/ where index.html resides
  build: {
    outDir: '../public', // Output to public/ relative to src/
    assetsDir: 'assets', // Subdirectory for CSS
    minify: 'terser', // Enable Terser minification
    terserOptions: {
      compress: {
        drop_console: false, // Keep console logs for debugging
        passes: 2 // Multiple passes for better compression
      },
      mangle: true // Shorten variable names
    },
    rollupOptions: {
      input: {
        js: 'src/js/index.js', // JavaScript entry point, outputs js.js
        tailwind: 'src/css/tailwind.css', // Tailwind CSS entry point
        index: 'src/index.html' // HTML entry point
      },
      output: {
        entryFileNames: '[name].[hash].js', // Add hash for cache busting
        chunkFileNames: 'assets/[name].[hash].js', // Dynamic chunks with hash
        assetFileNames: 'assets/[name].[hash].[ext]', // CSS with hash
        manualChunks(id) {
          // Code-splitting: Separate app.js into a chunk
          if (id.includes('app.js')) {
            return 'app';
          }
          // Other modules (core.js, auth.js, utils.js) stay in main chunk
        }
      }
    },
    sourcemap: true // Generate sourcemaps for debugging
  },
  publicDir: false, // Disable publicDir to avoid overlap
  envPrefix: 'VITE_', // For Firebase config variables
  base: '/', // Base URL for Netlify
  optimizeDeps: {
    include: ['firebase/auth', 'firebase/firestore'] // Pre-bundle Firebase dependencies
  }
});
