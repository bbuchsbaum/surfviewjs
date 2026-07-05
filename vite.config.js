import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@src': resolve(__dirname, 'src')
    },
    extensions: ['.ts', '.tsx', '.js', '.jsx']
  },
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
    sourcemap: false,
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
