import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig({
  resolve: {
    extensions: ['.ts', '.tsx', '.js', '.jsx']
  },
  build: {
    // Preserve the peer-dependency ESM/UMD build created by the first step.
    emptyOutDir: false,
    lib: {
      entry: resolve(import.meta.dirname, 'src/embed.ts'),
      name: 'surfview',
      fileName: () => 'surfview.embed.iife.js',
      formats: ['iife']
    },
    // The self-contained embed is large and has no downstream source-map
    // compatibility contract. Core maps remain published by vite.config.js.
    sourcemap: false,
    minify: 'terser',
    terserOptions: {
      compress: {
        drop_console: false,
        drop_debugger: true
      }
    }
  }
});
