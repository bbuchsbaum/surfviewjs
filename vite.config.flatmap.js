import { defineConfig } from 'vite';
import { dirname, resolve } from 'node:path';

// Keep core class identities and display registries shared with surfview.
const shared = new Set([
  'classes', 'EventEmitter', 'ColorMap', 'geometry/GeometryError', 'geometry/SurfaceDomain',
  'geometry/GeometryExecutor', 'geometry/GeometryWorkerClient', 'geometry/SurfaceLocation',
  'geometry/SurfaceArea', 'geometry/SurfaceSmoothing', 'geometry/DisplayGeometryBinding',
  'geometry/DisplayDeformation'
].map(path => resolve(import.meta.dirname, 'src', path)));

export default defineConfig({
  resolve: { extensions: ['.ts', '.tsx', '.js'] },
  plugins: [{
    name: 'externalize-flatmap-core', enforce: 'pre',
    resolveId(source, importer) {
      if (importer && source.startsWith('.') && shared.has(resolve(dirname(importer), source).replace(/\.ts$/, ''))) {
        return { id: './surfview.es.js', external: true };
      }
      return null;
    }
  }],
  build: {
    emptyOutDir: false,
    lib: { entry: resolve(import.meta.dirname, 'src/index.flatmap.ts'), formats: ['es'], fileName: () => 'surfview.flatmap.es.js' },
    rollupOptions: { external: ['three'] },
    sourcemap: true, minify: 'terser',
    terserOptions: { compress: { drop_console: false, drop_debugger: true } }
  }
});
