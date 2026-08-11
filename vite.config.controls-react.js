import { defineConfig } from 'vite';
import { resolve } from 'path';

// Thin React adapter for `surfview/controls/react`. React and the complete
// controls implementation remain external; this artifact owns lifecycle glue
// only and imports the sibling optional controls bundle at runtime.
const CONTROLS_SPECIFIERS = new Set(['./index']);

export default defineConfig({
  resolve: {
    extensions: ['.ts', '.tsx', '.js', '.jsx']
  },
  plugins: [
    {
      name: 'externalize-controls-bundle',
      enforce: 'pre',
      resolveId(source) {
        if (CONTROLS_SPECIFIERS.has(source)) {
          return { id: './surfview.controls.es.js', external: true };
        }
        return null;
      }
    }
  ],
  build: {
    emptyOutDir: false,
    lib: {
      entry: resolve(__dirname, 'src/controls-ui/react.tsx'),
      fileName: () => 'surfview.controls.react.es.js',
      formats: ['es']
    },
    rollupOptions: {
      external: ['react', 'react-dom', 'react/jsx-runtime']
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
