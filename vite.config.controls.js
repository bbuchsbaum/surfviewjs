import { defineConfig } from 'vite';
import { resolve } from 'path';

// Dedicated optional ESM build for `surfview/controls`. Lit is bundled here;
// the already-built SurfView core remains an external sibling import.
const CORE_SPECIFIERS = new Set(['../index']);

export default defineConfig({
  resolve: {
    extensions: ['.ts', '.tsx', '.js', '.jsx']
  },
  plugins: [
    {
      name: 'domless-safe-lit-import',
      enforce: 'pre',
      transform(code, id) {
        const moduleId = id.split('?')[0];
        if (moduleId.includes('/@lit/reactive-element/') &&
            moduleId.endsWith('/reactive-element.js')) {
          const baseClass = 'extends HTMLElement';
          const matches = code.split(baseClass).length - 1;
          if (matches !== 1) {
            throw new Error(
              `Expected one Lit HTMLElement base, found ${matches}. ` +
              'Review the pinned Lit integration before upgrading.'
            );
          }
          return {
            code: code.replace(
              baseClass,
              'extends (globalThis.HTMLElement ?? class {})'
            ),
            map: null
          };
        }

        if (moduleId.includes('/lit-html/') &&
            moduleId.endsWith('/lit-html.js')) {
          // Lit's browser entry captures `document` and creates a TreeWalker at
          // module evaluation time. Preserve that behavior in browsers while
          // using an inert, non-global fallback solely for DOM-less imports.
          const documentCapture = 'l=document,c=()=>l.createComment';
          const matches = code.split(documentCapture).length - 1;
          if (matches !== 1) {
            throw new Error(
              `Expected one Lit document capture, found ${matches}. ` +
              'Review the pinned Lit integration before upgrading.'
            );
          }
          return {
            code: code.replace(
              documentCapture,
              'l=globalThis.document??{createTreeWalker:()=>({})},' +
              'c=()=>l.createComment'
            ),
            map: null
          };
        }

        return null;
      }
    },
    {
      name: 'externalize-surfview-core',
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
    emptyOutDir: false,
    lib: {
      entry: resolve(__dirname, 'src/controls-ui/index.ts'),
      fileName: () => 'surfview.controls.es.js',
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
