import { defineConfig } from 'vite';
import { resolve } from 'path';

// Dedicated build for the React subpath export (`surfview/react`).
//
// This bundles the React wrapper components (JSX) into a single ESM file and
// externalizes the core library so the main bundle is not duplicated: the
// emitted bundle re-exports from the sibling `./surfview.es.js`.
//
// Output: dist/surfview.react.es.js (ESM only — React tooling is ESM-first).

const PEER_EXTERNALS = [
  'react',
  'react-dom',
  'three'
];

// The core index is imported as `./index` (from src/index.react.js) and
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
      entry: resolve(__dirname, 'src/index.react.js'),
      fileName: (format) => `surfview.react.${format}.js`,
      formats: ['es']
    },
    rollupOptions: {
      external: PEER_EXTERNALS
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
