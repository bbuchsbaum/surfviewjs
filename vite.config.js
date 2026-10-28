import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';

function legacyBundleAliases() {
  return {
    name: 'legacy-bundle-aliases',
    closeBundle() {
      for (const [source, target] of [
        // The .cjs copy is the actual Node/CommonJS entry. The .js UMD file
        // remains available for 2.x browser-script compatibility.
        ['surfview.umd.js', 'surfview.umd.cjs'],
        ['surfview.es.js', 'neurosurface.es.js'],
        ['surfview.es.js.map', 'neurosurface.es.js.map'],
        ['surfview.umd.js', 'neurosurface.umd.js'],
        ['surfview.umd.js.map', 'neurosurface.umd.js.map']
      ]) {
        const sourcePath = resolve(import.meta.dirname, 'dist', source);
        if (existsSync(sourcePath)) {
          const targetPath = resolve(import.meta.dirname, 'dist', target);
          if (target.endsWith('.map')) {
            // Legacy bundles already reference the canonical map. Preserve the
            // old map URL too, using standard indexed-map indirection rather
            // than republishing megabytes of identical sourcesContent.
            writeFileSync(targetPath, JSON.stringify({ version: 3, file: target.slice(0, -4), sections: [{ offset: { line: 0, column: 0 }, url: source }] }));
          } else copyFileSync(sourcePath, targetPath);
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
        const embedPath = resolve(import.meta.dirname, 'dist', 'surfview.embed.iife.js');
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
      '@src': resolve(import.meta.dirname, 'src')
    },
    extensions: ['.ts', '.tsx', '.js', '.jsx']
  },
  plugins: [serveBuiltEmbedWithoutTransforms(), legacyBundleAliases()],
  build: {
    lib: {
      entry: resolve(import.meta.dirname, 'src/index.ts'),
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
      'react/jsx-runtime',
      'react/jsx-dev-runtime'
    ]
  }
});
