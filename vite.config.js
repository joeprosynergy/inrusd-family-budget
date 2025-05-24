import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    outDir: 'public',
    minify: 'terser', // Enable Terser minification
    terserOptions: {
      compress: {
        drop_console: false, // Keep console logs for debugging
        drop_debugger: true,
        pure_funcs: ['console.info', 'console.debug'], // Remove non-essential logs
      },
      mangle: true, // Mangle variable names
      format: {
        comments: false, // Remove comments
      },
    },
    rollupOptions: {
      output: {
        // Code splitting: Create chunks for non-critical modules
        manualChunks: {
          'auth-core': ['./src/js/auth.js', './src/js/core.js'], // Critical: auth and UI init
          'app-tabs': ['./src/js/app.js'], // Non-critical: tab logic
          'firebase': ['firebase/auth', 'firebase/firestore'], // Firebase SDK
        },
        // Ensure chunk filenames include hashes for caching
        entryFileNames: '[name].[hash].js',
        chunkFileNames: '[name].[hash].js',
        assetFileNames: 'assets/[name].[hash][extname]',
      },
    },
  },
});
