import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

const fixtureRoot = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  root: fixtureRoot,
  build: {
    outDir: '../../../.tmp/react-controls-fixture-dist',
    emptyOutDir: true
  }
});
