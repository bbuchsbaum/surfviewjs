import { defineConfig } from 'vite';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const demoRoot = resolve(__dirname, 'demo');

export default defineConfig({
  root: demoRoot,
  base: process.env.GITHUB_ACTIONS ? '/surfviewjs/' : '/',
  resolve: {
    alias: {
      '@src': resolve(__dirname, 'src')
    },
    extensions: ['.ts', '.js']
  },
  assetsInclude: ['**/*.gii'],
  server: {
    fs: {
      allow: [demoRoot, resolve(__dirname, 'tests/data')]
    }
  },
  build: {
    outDir: resolve(__dirname, 'demo-dist'),
    emptyOutDir: true,
    rollupOptions: {
      input: resolve(demoRoot, 'index.html')
    }
  }
});
