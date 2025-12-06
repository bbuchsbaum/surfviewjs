import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  resolve: {
    extensions: ['.ts', '.tsx', '.js', '.jsx']
  },
  build: {
    lib: {
      entry: resolve(__dirname, 'src/index.js'),
      name: 'neurosurface',
      fileName: (format) => `neurosurface.${format}.js`,
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
