import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  resolve: {
    extensions: ['.ts', '.tsx', '.js', '.jsx']
  },
  build: {
    // Preserve the peer-dependency ESM/UMD build created by the first step.
    emptyOutDir: false,
    lib: {
      entry: resolve(__dirname, 'src/embed.ts'),
      name: 'surfview',
      fileName: () => 'surfview.embed.iife.js',
      formats: ['iife']
    },
    rollupOptions: {
      output: {
        inlineDynamicImports: true
      }
    },
    sourcemap: true,
    minify: 'terser',
    terserOptions: {
      compress: {
        drop_console: false,
        drop_debugger: true
      }
    }
  }
});
