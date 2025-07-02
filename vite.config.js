import { defineConfig } from 'vite';

export default defineConfig({
  root: 'src',
  build: {
    outDir: '../public',
    assetsDir: 'assets',
    rollupOptions: {
      input: {
        js: 'src/js/index.js',
        tailwind: 'src/css/tailwind.css',
        index: 'src/index.html'
      },
      output: {
        entryFileNames: '[name].[hash].js',
        chunkFileNames: 'chunks/[name].[hash].js',
        assetFileNames: 'assets/[name].[hash].[ext]',
        // Simplified manual chunks focusing on largest dependencies
        manualChunks: (id) => {
          if (id.includes('node_modules')) {
            if (id.includes('firebase')) {
              return 'firebase';
            }
            if (id.includes('tailwindcss') || id.includes('postcss')) {
              return 'css-vendor';
            }
            return 'vendor';
          }
        }
      },
      // Enable tree shaking
      treeshake: {
        moduleSideEffects: false
      }
    },
    sourcemap: false, // Disable for production to reduce size
    cssMinify: true,
    minify: 'terser',
    terserOptions: {
      compress: {
        drop_console: true,
        drop_debugger: true,
        pure_funcs: ['console.log', 'console.info', 'console.debug']
      }
    },
    // More aggressive chunk size limit
    chunkSizeWarningLimit: 250
  },
  publicDir: false,
  envPrefix: 'VITE_',
  base: '/',
  // Enhanced performance optimizations
  optimizeDeps: {
    include: ['firebase/app', 'firebase/auth', 'firebase/firestore'],
    exclude: []
  },
  esbuild: {
    // Additional esbuild optimizations
    legalComments: 'none',
    minifyIdentifiers: true,
    minifySyntax: true,
    minifyWhitespace: true
  }
});
