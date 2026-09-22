import { defineConfig } from 'vite';
import { resolve } from 'node:path';

// Dedicated build for the React subpath export (`surfview/react`).
//
// This bundles the React wrapper components (TSX) into a single ESM file and
// externalizes the core library so the main bundle is not duplicated: the
// emitted bundle re-exports from the sibling `./surfview.es.js`.
//
// Output: dist/surfview.react.es.js (ESM only — React tooling is ESM-first).

const PEER_EXTERNALS = [
  'react',
  'react-dom',
  'three'
];

function isPeerExternal(id) {
  return PEER_EXTERNALS.some(peer => id === peer || id.startsWith(`${peer}/`));
}

// The core index is imported as `./index` (from src/index.react.ts) and
// `../index` (from src/react/*). Rewrite both to the built main bundle and keep
// them external so the core is not inlined a second time. (Rollup ignores
// `output.paths` for relative external specifiers, so this must be done in
// resolveId.)
const CORE_SPECIFIERS = new Set(['./index', '../index']);

export default defineConfig({
  resolve: {
    extensions: ['.ts', '.tsx', '.js', '.jsx']
  },
  plugins: [
    {
      name: 'externalize-core-bundle',
      enforce: 'pre',
      resolveId(source) {
        if (CORE_SPECIFIERS.has(source)) {
          return { id: './surfview.es.js', external: true };
        }
        return null;
      }
    }
  ],
  build: {
    // Do not wipe the main bundle produced by the primary build step.
    emptyOutDir: false,
    lib: {
      entry: resolve(import.meta.dirname, 'src/index.react.ts'),
      fileName: (format) => `surfview.react.${format}.js`,
      formats: ['es']
    },
    rollupOptions: {
      external: isPeerExternal
    },
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
