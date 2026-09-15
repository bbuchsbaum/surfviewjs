import { build } from 'vite';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

// Offline, single-file copies of both dedicated demos. No serving or publication.
const root = resolve(import.meta.dirname, '..');
const escape = text => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const licenses = await Promise.all(['schaefer', 'glasser'].map(async atlas => ({
  atlas, license: await readFile(resolve(root, `demo/data/${atlas}/LICENSE.txt`), 'utf8'),
  provenance: await readFile(resolve(root, `demo/data/${atlas}/README.md`), 'utf8')
})));
const credits = `<details style="margin:18px 28px;font:12px/1.5 system-ui;color:#536671"><summary>Atlas provenance and licenses</summary>${licenses.map(({ atlas, license, provenance }) =>
  `<h3>${escape(atlas)}</h3><pre style="white-space:pre-wrap">${escape(provenance)}\n${escape(license)}</pre>`).join('')}</details>`;
for (const entry of [{ source: 'puzzle', output: 'parcel-puzzle-demo.html' }, { source: 'map-lab', output: 'parcel-map-lab.html' }]) {
  const destination = resolve(root, `output/concepts/${entry.output}`);
  const result = await build({
    configFile: false,
    root,
    publicDir: false,
    resolve: { alias: { '@src': resolve(root, 'src') }, extensions: ['.ts', '.js'] },
    assetsInclude: ['**/*.gii'],
    build: {
      write: false,
      minify: true,
      lib: { entry: resolve(root, `demo/${entry.source}.ts`), name: 'ParcelDemo', formats: ['iife'] }
    }
  });
  const bundle = (Array.isArray(result) ? result : [result]).flatMap(item => item.output)
    .find(item => item.type === 'chunk' && item.isEntry);
  if (!bundle || bundle.type !== 'chunk') throw new Error('No standalone puzzle entry was generated');
  const template = await readFile(resolve(root, `demo/${entry.source}.html`), 'utf8');
  const html = template.replace(`<script type="module" src="./${entry.source}.ts"></script>`,
    () => `<script>${bundle.code.replaceAll('</script', '<\\/script')}</script>${credits}`).replace('href="./puzzle.html"', 'href="./parcel-puzzle-demo.html"').replace('href="./map-lab.html"', 'href="./parcel-map-lab.html"');
  await mkdir(resolve(root, 'output/concepts'), { recursive: true });
  await writeFile(destination, html);
  console.log(destination);
}
