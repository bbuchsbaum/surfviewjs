import { defineConfig } from 'vite';
import { resolve } from 'path';
import { copyFileSync, existsSync } from 'fs';

function legacyBundleAliases() {
  return {
    name: 'legacy-bundle-aliases',
    closeBundle() {
      for (const [source, target] of [
        ['surfview.es.js', 'neurosurface.es.js'],
        ['surfview.es.js.map', 'neurosurface.es.js.map'],
        ['surfview.umd.js', 'neurosurface.umd.js'],
        ['surfview.umd.js.map', 'neurosurface.umd.js.map']
      ]) {
        const sourcePath = resolve(__dirname, 'dist', source);
        if (existsSync(sourcePath)) {
          copyFileSync(sourcePath, resolve(__dirname, 'dist', target));
        }
      }
    }
  };
}

export default defineConfig({
  resolve: {
    alias: {
      '@src': resolve(__dirname, 'src')
    },
    extensions: ['.ts', '.tsx', '.js', '.jsx']
  },
  plugins: [legacyBundleAliases()],
  build: {
    lib: {
      entry: resolve(__dirname, 'src/index.ts'),
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
  optimizeDeps: {
    include: ['three', 'tweakpane', '@tweakpane/plugin-essentials', 'colormap'],
    exclude: ['react', 'react-dom', '@tweakpane/plugin-interval']
  }
});
