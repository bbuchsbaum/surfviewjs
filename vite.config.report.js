import { defineConfig } from 'vite';
import { resolve } from 'path';

// Thin ESM entry for `surfview/report`. Report symbols remain compatibility
// re-exports of the already-built core during 2.x, so this entry must never
// duplicate the viewer, Three.js, or report runtime implementation.
export default defineConfig({
  resolve: {
    extensions: ['.ts', '.tsx', '.js', '.jsx']
  },
  plugins: [
    {
      name: 'externalize-report-core',
      enforce: 'pre',
      resolveId(source) {
        if (source === './index') {
          return { id: './surfview.es.js', external: true };
        }
        return null;
      }
    }
  ],
  build: {
    emptyOutDir: false,
    lib: {
      entry: resolve(__dirname, 'src/index.report.ts'),
      fileName: () => 'surfview.report.es.js',
      formats: ['es']
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
