import { defineConfig } from 'vite';
import { resolve } from 'node:path';

// Standalone module worker: no browser globals or worker construction on library import.
export default defineConfig({
  build: {
    emptyOutDir: false,
    lib: { entry: resolve(import.meta.dirname, 'src/geometry/geometryWorker.ts'), formats: ['es'], fileName: () => 'surfview.geometry.worker.js' },
    minify: 'terser', sourcemap: false
  }
});
