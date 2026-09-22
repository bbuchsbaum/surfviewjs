import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

const fixtureRoot = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  root: fixtureRoot,
  build: {
    outDir: '../../../.tmp/react-controls-fixture-dist',
    emptyOutDir: true,
    // This downstream fixture intentionally bundles React, Three.js, the core,
    // and controls so externals cannot mask consumer breakage. Published entry
    // sizes are enforced separately by `npm run size`.
    chunkSizeWarningLimit: 1200
  }
});
