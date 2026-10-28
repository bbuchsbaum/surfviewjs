import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { access, readFile, mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDirectory, '..');
const packageJson = JSON.parse(await readFile(
  join(projectRoot, 'package.json'),
  'utf8'
));
assert.deepEqual(
  Object.keys(packageJson.exports).sort(),
  ['.', './controls', './controls/react', './geometry-worker', './react', './report'],
  'Every advertised package export must have an explicit packed-consumer case'
);
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? projectRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      ...options.env
    }
  });
  if (result.status !== 0) {
    throw new Error([
      `Command failed (${result.status}): ${command} ${args.join(' ')}`,
      result.stdout,
      result.stderr
    ].filter(Boolean).join('\n'));
  }
  return result.stdout;
}

async function pathExists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

const fixtureRoot = await mkdtemp(join(tmpdir(), 'surfview-package-consumers-'));
const keepFixture = process.env.SURFVIEW_KEEP_PACKAGE_FIXTURE === '1';

try {
  const packOutput = run(npmCommand, [
    'pack',
    '--json',
    '--ignore-scripts',
    '--pack-destination', fixtureRoot,
    '--cache', join(fixtureRoot, 'npm-cache')
  ]);
  const [packResult] = JSON.parse(packOutput);
  assert.ok(packResult?.filename, 'npm pack did not report an archive filename');
  const archivePath = join(fixtureRoot, packResult.filename);
  const packedPaths = new Set(packResult.files.map(file => file.path));
  for (const requiredPath of [
    'dist/surfview.es.js',
    'dist/surfview.es.js.map',
    'dist/surfview.umd.js',
    'dist/surfview.umd.js.map',
    'dist/surfview.umd.cjs',
    'dist/neurosurface.es.js',
    'dist/neurosurface.es.js.map',
    'dist/neurosurface.umd.js',
    'dist/neurosurface.umd.js.map',
    'dist/surfview.embed.iife.js',
    'dist/surfview.react.es.js',
    'dist/surfview.controls.es.js',
    'dist/surfview.controls.react.es.js',
    'dist/surfview.report.es.js',
    'dist/surfview.geometry.worker.js',
    'dist/types/geometry/geometryWorker.d.ts',
    'dist/types/index.d.ts'
  ]) {
    assert.ok(packedPaths.has(requiredPath), `Packed archive is missing ${requiredPath}`);
  }
  for (const unpublishedMap of [
    'dist/surfview.embed.iife.js.map',
    'dist/surfview.react.es.js.map',
    'dist/surfview.report.es.js.map',
    'dist/surfview.controls.es.js.map',
    'dist/surfview.controls.react.es.js.map'
  ]) {
    assert.equal(
      packedPaths.has(unpublishedMap),
      false,
      `Packed archive unexpectedly includes ${unpublishedMap}`
    );
  }
  for (const [alias, canonical] of [['neurosurface.es.js.map', 'surfview.es.js.map'], ['neurosurface.umd.js.map', 'surfview.umd.js.map']]) {
    const map = JSON.parse(await readFile(resolve(projectRoot, 'dist', alias), 'utf8'));
    assert.deepEqual(map.sections, [{ offset: { line: 0, column: 0 }, url: canonical }]);
    const full = JSON.parse(await readFile(resolve(projectRoot, 'dist', canonical), 'utf8'));
    assert.ok(full.sourcesContent.length > 0, 'Canonical maps must retain embedded source content');
  }
  assert.ok(packResult.size <= 5 * 1024 * 1024, 'Packed archive exceeds the 5 MiB ceiling');
  assert.ok(
    packResult.unpackedSize <= 15 * 1024 * 1024,
    'Unpacked archive exceeds the 15 MiB ceiling'
  );

  const [
    esmArtifact,
    umdArtifact,
    commonJsArtifact,
    legacyEsmArtifact,
    legacyUmdArtifact,
    esmSourceMap,
    umdSourceMap,
    legacyEsmSourceMap,
    legacyUmdSourceMap
  ] = await Promise.all([
    readFile(join(projectRoot, 'dist/surfview.es.js')),
    readFile(join(projectRoot, 'dist/surfview.umd.js')),
    readFile(join(projectRoot, 'dist/surfview.umd.cjs')),
    readFile(join(projectRoot, 'dist/neurosurface.es.js')),
    readFile(join(projectRoot, 'dist/neurosurface.umd.js')),
    readFile(join(projectRoot, 'dist/surfview.es.js.map')),
    readFile(join(projectRoot, 'dist/surfview.umd.js.map')),
    readFile(join(projectRoot, 'dist/neurosurface.es.js.map')),
    readFile(join(projectRoot, 'dist/neurosurface.umd.js.map'))
  ]);
  assert.deepEqual(
    commonJsArtifact,
    umdArtifact,
    'The CommonJS and browser UMD compatibility artifacts drifted'
  );
  assert.deepEqual(legacyEsmArtifact, esmArtifact, 'Legacy ESM alias drifted from core ESM');
  assert.deepEqual(legacyUmdArtifact, umdArtifact, 'Legacy UMD alias drifted from browser UMD');
  for (const [aliasBytes, canonicalBytes, name] of [[legacyEsmSourceMap, esmSourceMap, 'surfview.es.js.map'], [legacyUmdSourceMap, umdSourceMap, 'surfview.umd.js.map']]) {
    const alias = JSON.parse(aliasBytes.toString('utf8'));
    assert.deepEqual(alias.sections, [{ offset: { line: 0, column: 0 }, url: name }]);
    assert.deepEqual(await readFile(join(projectRoot, 'dist', alias.sections[0].url)), canonicalBytes, 'Indexed legacy map must resolve to the complete canonical map');
  }
  for (const [name, sourceMapBytes] of [
    ['ESM', esmSourceMap],
    ['UMD', umdSourceMap]
  ]) {
    const sourceMap = JSON.parse(sourceMapBytes.toString('utf8'));
    assert.ok(sourceMap.sources.length > 0, `${name} source map has no sources`);
    assert.equal(
      sourceMap.sources.length,
      sourceMap.sourcesContent.length,
      `${name} source map must carry matching open-source sourcesContent`
    );
  }

  const coreOnlyRoot = join(fixtureRoot, 'core-only-consumer');
  await mkdir(coreOnlyRoot);
  await writeFile(join(coreOnlyRoot, 'package.json'), JSON.stringify({
    name: 'surfview-packed-core-only-consumer',
    private: true,
    type: 'module'
  }, null, 2));
  run(npmCommand, [
    'install',
    '--ignore-scripts',
    '--no-audit',
    '--no-fund',
    '--package-lock=false',
    '--omit=optional',
    '--cache', join(fixtureRoot, 'npm-cache'),
    archivePath,
    `three@${packageJson.devDependencies.three}`
  ], { cwd: coreOnlyRoot });
  assert.equal(
    await pathExists(join(coreOnlyRoot, 'node_modules/react')),
    false,
    'A core-only installation unexpectedly installed React'
  );
  await writeFile(join(coreOnlyRoot, 'core-only.cjs'), `
const assert = require('node:assert/strict');
const surfview = require('surfview');
assert.equal(typeof surfview.NeuroSurfaceViewer, 'function');
`);
  await writeFile(join(coreOnlyRoot, 'core-only.mjs'), `
import assert from 'node:assert/strict';
import { NeuroSurfaceViewer } from 'surfview';
assert.equal(typeof NeuroSurfaceViewer, 'function');
`);
  run(process.execPath, ['core-only.cjs'], { cwd: coreOnlyRoot });
  run(process.execPath, ['core-only.mjs'], { cwd: coreOnlyRoot });

  // The worker subpath is an artifact URL, not a module to execute on the UI/main thread.
  await writeFile(join(coreOnlyRoot, 'geometry-worker.mjs'), `
import assert from 'node:assert/strict';
import { Worker } from 'node:worker_threads';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { SurfaceDomain, SurfaceMetric, buildSurfaceSmoothingPlan } from 'surfview';
const require = createRequire(import.meta.url);
const url = pathToFileURL(require.resolve('surfview/geometry-worker')).href;
assert.equal(import.meta.resolve('surfview/geometry-worker'), url);
const bootstrap = "import { parentPort } from 'node:worker_threads'; globalThis.addEventListener = (_, fn) => parentPort.on('message', data => fn({data})); globalThis.postMessage = value => parentPort.postMessage(value); await import(" + JSON.stringify(url) + "); parentPort.postMessage({ready:true});";
const worker = new Worker(new URL('data:text/javascript,' + encodeURIComponent(bootstrap)), { type: 'module' });
try {
  await new Promise((resolve, reject) => { worker.once('message', resolve); worker.once('error', reject); });
  let id = 0;
  const clientId = 'packed-consumer';
  const request = command => new Promise((resolve, reject) => {
    const current = ++id;
    const timer = setTimeout(() => { worker.off('message', receive); reject(new Error('Packed worker request timed out: ' + command.type)); }, 10000);
    const receive = message => { if (message.clientId !== clientId || message.id !== current) return; clearTimeout(timer); worker.off('message', receive); if (message.error) reject(new Error(message.error.message)); else resolve(message.value); };
    worker.on('message', receive); worker.postMessage({protocol:1,clientId,id:current,command});
  });
  const options = {id:'packed-triangle',structure:'synthetic',vertexCount:3,faces:new Uint32Array([0,1,2])};
  const domain = new SurfaceDomain(options), metricOptions = {positions:new Float64Array([0,0,0,1,0,0,0,1,0]),frame:'mm',units:'mm'};
  const d = await request({type:'domain',options}), m = await request({type:'metric',domain:d,options:metricOptions});
  const p = await request({type:'smoothing',metric:m,options:{fwhmMm:2}});
  const result = await request({type:'apply',plan:p,values:new Float64Array([0,2,4])});
  assert.deepEqual(result, buildSurfaceSmoothingPlan(new SurfaceMetric(domain,metricOptions),{fwhmMm:2}).apply([0,2,4]));
  for (const handle of [d,m,p]) await request({type:'release',handle});
} finally { await worker.terminate(); }
process.stdout.write('Packed worker URL resolution and numerical execution passed\\n');
`);
  run(process.execPath, ['geometry-worker.mjs'], { cwd: coreOnlyRoot });

  const consumerRoot = join(fixtureRoot, 'consumer');
  await mkdir(consumerRoot);
  await writeFile(join(consumerRoot, 'package.json'), JSON.stringify({
    name: 'surfview-packed-consumer',
    private: true,
    type: 'module'
  }, null, 2));

  const installVersions = {
    react: packageJson.devDependencies.react,
    'react-dom': packageJson.devDependencies['react-dom'],
    three: packageJson.devDependencies.three,
    '@types/react': packageJson.devDependencies['@types/react'],
    '@types/react-dom': packageJson.devDependencies['@types/react-dom'],
    '@types/three': packageJson.devDependencies['@types/three']
  };
  run(npmCommand, [
    'install',
    '--ignore-scripts',
    '--no-audit',
    '--no-fund',
    '--package-lock=false',
    '--cache', join(fixtureRoot, 'npm-cache'),
    archivePath,
    ...Object.entries(installVersions).map(([name, version]) => `${name}@${version}`)
  ], { cwd: consumerRoot });

  await writeFile(join(consumerRoot, 'consumer.cjs'), `
const assert = require('node:assert/strict');
const surfview = require('surfview');
assert.equal(typeof surfview.NeuroSurfaceViewer, 'function');
assert.equal(typeof surfview.MultiLayerNeuroSurface, 'function');
assert.equal(typeof surfview.tToZ, 'function');
assert.ok(Object.keys(surfview).length > 100);
process.stdout.write('CommonJS root consumer passed\\n');
`);
  run(process.execPath, ['consumer.cjs'], { cwd: consumerRoot });

  await writeFile(join(consumerRoot, 'consumer.mjs'), `
import assert from 'node:assert/strict';
import * as core from 'surfview';
import * as react from 'surfview/react';
import * as controls from 'surfview/controls';
import * as controlsReact from 'surfview/controls/react';
import * as report from 'surfview/report';

assert.equal(typeof core.NeuroSurfaceViewer, 'function');
assert.equal(typeof core.tToZ, 'function');
assert.ok(react.NeuroSurfaceViewerReact);
assert.equal(typeof react.useNeuroSurface, 'function');
assert.equal(typeof controls.mountSurfViewControls, 'function');
assert.ok(controlsReact.SurfViewControls);
assert.equal(report.ReportSceneController, core.ReportSceneController);
assert.equal(report.mountSurfView, core.mountSurfView);
process.stdout.write('ESM and optional-subpath consumers passed\\n');
`);
  run(process.execPath, ['consumer.mjs'], { cwd: consumerRoot });

  const [quickstartExample, statisticsExample, geometryExample] = await Promise.all([
    readFile(join(projectRoot, 'examples/quickstart.ts'), 'utf8'),
    readFile(join(projectRoot, 'examples/statistical-equivalence.js'), 'utf8'),
    readFile(join(projectRoot, 'examples/surface-geometry.ts'), 'utf8')
  ]);
  await Promise.all([
    writeFile(join(consumerRoot, 'quickstart.ts'), quickstartExample),
    writeFile(join(consumerRoot, 'statistical-equivalence.js'), statisticsExample),
    writeFile(join(consumerRoot, 'surface-geometry.ts'), geometryExample)
  ]);
  run(process.execPath, ['statistical-equivalence.js'], { cwd: consumerRoot });
  run(process.execPath, ['surface-geometry.ts'], { cwd: consumerRoot });

  await writeFile(join(consumerRoot, 'consumer.tsx'), `
import React, { createRef } from 'react';
import { tToZ } from 'surfview';
import type { NeuroSurfaceViewer } from 'surfview';
import { NeuroSurfaceViewerReact, useNeuroSurface } from 'surfview/react';
import type { NeuroSurfaceViewerHandle } from 'surfview/react';
import { mountSurfViewControls } from 'surfview/controls';
import { SurfViewControls } from 'surfview/controls/react';
import { mountSurfView } from 'surfview/report';
import type { SurfViewMountHandle, SurfViewSceneManifest } from 'surfview/report';

declare const viewer: NeuroSurfaceViewer;
declare const host: HTMLElement;
declare const manifest: SurfViewSceneManifest;
const z: number = tToZ(2, 10);
const ref = createRef<NeuroSurfaceViewerHandle>();
const legacyReact = <NeuroSurfaceViewerReact ref={ref} width={0} height={0} />;
const controlsReact = <SurfViewControls viewer={viewer} />;
const hook = useNeuroSurface({ current: viewer });
const controlsHandle = mountSurfViewControls(viewer, host);
const reportHandle: SurfViewMountHandle = mountSurfView(host, manifest);
void [React, z, legacyReact, controlsReact, hook, controlsHandle, reportHandle];

// @ts-expect-error t must be numeric.
tToZ('2', 10);
// @ts-expect-error the controls React entry requires a viewer.
<SurfViewControls />;
// @ts-expect-error the viewer width is measured in numeric CSS pixels.
<NeuroSurfaceViewerReact width="800" />;
`);
  await writeFile(join(consumerRoot, 'tsconfig.json'), JSON.stringify({
    compilerOptions: {
      target: 'ES2020',
      module: 'ESNext',
      moduleResolution: 'Bundler',
      jsx: 'react-jsx',
      strict: true,
      noEmit: true,
      skipLibCheck: false,
      lib: ['ES2020', 'DOM', 'DOM.Iterable']
    },
    include: ['consumer.tsx', 'quickstart.ts', 'surface-geometry.ts']
  }, null, 2));
  run(process.execPath, [
    join(projectRoot, 'node_modules/typescript/bin/tsc'),
    '--project', join(consumerRoot, 'tsconfig.json')
  ], { cwd: consumerRoot });

  process.stdout.write(
    `packed consumer audit passed on Node ${process.version}: ` +
    `${packResult.entryCount} entries, ${packResult.size} B archive, ` +
    `${packResult.unpackedSize} B unpacked; ` +
    'surfview.umd.js and surfview.umd.cjs are the one intentional 2.x ' +
    'browser/CommonJS compatibility duplicate; legacy neurosurface aliases ' +
    'match byte-for-byte and legacy source maps resolve to complete canonical maps; canonical documentation ' +
    'examples compiled/executed against the archive\n'
  );
} finally {
  if (keepFixture) {
    process.stdout.write(`kept packed consumer fixture at ${fixtureRoot}\n`);
  } else {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
}
