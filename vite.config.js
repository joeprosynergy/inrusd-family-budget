import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    outDir: 'public',
    assetsDir: 'assets',
    rollupOptions: {
      input: {
        main: 'src/js/index.js',
        tailwind: 'src/css/tailwind.css'
      },
      output: {
        entryFileNames: '[name].js',
        assetFileNames: 'assets/[name].[ext]'
      }
    },
    sourcemap: true
  },
  envPrefix: 'VITE_',
  base: '/'
});
