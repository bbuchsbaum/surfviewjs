import { defineConfig } from 'vite';
import { resolve } from 'path';
import { copyFileSync } from 'fs';

export default defineConfig({
  resolve: {
    extensions: ['.ts', '.tsx', '.js', '.jsx']
  },
  build: {
    lib: {
      entry: resolve(__dirname, 'src/index.js'),
      name: 'surfview',
      fileName: (format) => `surfview.${format}.js`,
      formats: ['es', 'umd']
    },
    rollupOptions: {
      external: ['react', 'react-dom', 'three', 'tweakpane', '@tweakpane/plugin-essentials'],
      output: {
        globals: {
          'react': 'React',
          'react-dom': 'ReactDOM',
          'three': 'THREE',
          'tweakpane': 'Tweakpane',
          '@tweakpane/plugin-essentials': 'TweakpaneEssentials'
        }
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
  },
  plugins: [
    {
      name: 'copy-legacy-bundle',
      closeBundle() {
        // Create legacy neurosurface aliases for backwards compatibility
        try {
          copyFileSync('dist/surfview.es.js', 'dist/neurosurface.es.js');
          copyFileSync('dist/surfview.es.js.map', 'dist/neurosurface.es.js.map');
          copyFileSync('dist/surfview.umd.js', 'dist/neurosurface.umd.js');
          copyFileSync('dist/surfview.umd.js.map', 'dist/neurosurface.umd.js.map');
          console.log('✓ Created legacy neurosurface.* aliases');
        } catch (e) {
          console.warn('Could not create legacy aliases:', e.message);
        }
      }
    }
  ],
  optimizeDeps: {
    include: ['three', 'tweakpane', '@tweakpane/plugin-essentials', 'colormap'],
    exclude: ['react', 'react-dom', '@tweakpane/plugin-interval']
  }
});
