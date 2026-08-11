import { defineConfig } from 'vite';
import { resolve } from 'path';
import { copyFileSync, existsSync, readFileSync } from 'fs';

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

function serveBuiltEmbedWithoutTransforms() {
  return {
    name: 'serve-built-embed-without-transforms',
    configureServer(server) {
      server.middlewares.use('/dist/surfview.embed.iife.js', (_request, response) => {
        const embedPath = resolve(__dirname, 'dist', 'surfview.embed.iife.js');
        if (!existsSync(embedPath)) {
          response.statusCode = 404;
          response.end('Run npm run build before the embed browser test.');
          return;
        }
        response.setHeader('Content-Type', 'text/javascript; charset=utf-8');
        response.end(readFileSync(embedPath));
      });
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
  plugins: [serveBuiltEmbedWithoutTransforms(), legacyBundleAliases()],
  build: {
    lib: {
      entry: resolve(__dirname, 'src/index.ts'),
      name: 'surfview',
      fileName: (format) => `surfview.${format}.js`,
      formats: ['es', 'umd']
    },
    rollupOptions: {
      external: ['react', 'react-dom', 'three'],
      output: {
        globals: {
          'react': 'React',
          'react-dom': 'ReactDOM',
          'three': 'THREE'
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
    include: [
      'three',
      'colormap',
      'react',
      'react-dom',
      'react-dom/client',
      'react/jsx-runtime'
    ]
  }
});
