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
        entryFileNames: '[name].js',
        assetFileNames: 'assets/[name].[ext]'
      }
    },
    sourcemap: true,
    cssMinify: true
  },
  publicDir: false,
  envPrefix: 'VITE_',
  base: '/'
});
