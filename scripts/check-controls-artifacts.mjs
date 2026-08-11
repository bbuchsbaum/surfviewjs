import { brotliCompressSync } from 'node:zlib';
import { readFile } from 'node:fs/promises';
import process from 'node:process';
import { pathToFileURL, URL } from 'node:url';
import { JSDOM } from 'jsdom';

const corePath = new URL('../dist/surfview.es.js', import.meta.url);
const reportPath = new URL('../dist/surfview.report.es.js', import.meta.url);
const controlsPath = new URL('../dist/surfview.controls.es.js', import.meta.url);
const controlsReactPath = new URL('../dist/surfview.controls.react.es.js', import.meta.url);
const publicDeclarationPaths = [
  new URL('../dist/types/controls-ui/index.d.ts', import.meta.url),
  new URL('../dist/types/controls-ui/public-element.d.ts', import.meta.url),
  new URL('../dist/types/controls-ui/mount.d.ts', import.meta.url),
  new URL('../dist/types/controls-ui/react.d.ts', import.meta.url)
];
const [core, report, controls, controlsReact, ...publicDeclarations] = await Promise.all([
  readFile(corePath, 'utf8'),
  readFile(reportPath, 'utf8'),
  readFile(controlsPath, 'utf8'),
  readFile(controlsReactPath, 'utf8'),
  ...publicDeclarationPaths.map((path) => readFile(path, 'utf8'))
]);

for (const [index, declaration] of publicDeclarations.entries()) {
  for (const marker of ["from 'lit'", 'from "lit"', 'import("lit")', 'lit-html']) {
    if (declaration.includes(marker)) {
      throw new Error(
        `Public controls declaration ${publicDeclarationPaths[index].pathname} ` +
        `unexpectedly exposes optional UI implementation type: ${marker}`
      );
    }
  }
}

const forbiddenCoreMarkers = [
  'surfview-controls',
  'SurfViewControlsElement',
  'lit-element',
  'lit-html',
  '_$litType$',
  '--surfview-controls-'
];
for (const marker of forbiddenCoreMarkers) {
  if (core.includes(marker)) {
    throw new Error(`Core artifact unexpectedly contains optional UI marker: ${marker}`);
  }
}

if (!controls.includes('surfview-controls')) {
  throw new Error('Controls artifact does not contain its custom-element tag.');
}
if (!report.includes('./surfview.es.js')) {
  throw new Error('Report artifact does not externalize the SurfView core bundle.');
}
for (const duplicatedMarker of [
  'class NeuroSurfaceViewer',
  'class ReportSceneController',
  'surfview-controls',
  'lit-html'
]) {
  if (report.includes(duplicatedMarker)) {
    throw new Error(`Report artifact unexpectedly duplicates runtime code: ${duplicatedMarker}`);
  }
}
if (!controls.includes('./surfview.es.js')) {
  throw new Error('Controls artifact does not externalize the SurfView core bundle.');
}
if (!controlsReact.includes('./surfview.controls.es.js')) {
  throw new Error('React controls adapter does not externalize the controls bundle.');
}
if (!controlsReact.match(/from\s*["']react["']/)) {
  throw new Error('React controls adapter does not retain React as an external import.');
}
for (const duplicatedMarker of [
  'class SurfViewControlsElement',
  '--surfview-controls-background',
  'lit-html',
  '_$litType$'
]) {
  if (controlsReact.includes(duplicatedMarker)) {
    throw new Error(
      `React controls adapter unexpectedly duplicates controls UI: ${duplicatedMarker}`
    );
  }
}

const hadCustomElements = Object.hasOwn(globalThis, 'customElements');
const previousRegistry = globalThis.customElements;
let hadCustomElementsAfterImport = false;
let registryAfterImport;
let controlsModule;
try {
  controlsModule = await import(
    `${pathToFileURL(controlsPath.pathname).href}?artifact-check=${Date.now()}`
  );
  hadCustomElementsAfterImport = Object.hasOwn(globalThis, 'customElements');
  registryAfterImport = globalThis.customElements;
} finally {
  if (!hadCustomElements) {
    delete globalThis.customElements;
  } else {
    Object.defineProperty(globalThis, 'customElements', {
      configurable: true,
      value: previousRegistry
    });
  }
}
if (!hadCustomElements && hadCustomElementsAfterImport) {
  throw new Error('Importing the controls artifact created a customElements registry.');
}
if (hadCustomElements && registryAfterImport !== previousRegistry) {
  throw new Error('Importing the controls artifact replaced the customElements registry.');
}

const registryBeforeReportImport = globalThis.customElements;
const [coreModule, reportModule] = await Promise.all([
  import(pathToFileURL(corePath.pathname).href),
  import(`${pathToFileURL(reportPath.pathname).href}?artifact-check=${Date.now()}`)
]);
if (globalThis.customElements !== registryBeforeReportImport) {
  throw new Error('Importing the report adapter mutated customElements.');
}
for (const exportName of [
  'mountSurfView',
  'layoutReportAnatomicalMeshes',
  'ReportSceneController',
  'ReportSceneControlTarget',
  'createReportSceneControlTarget'
]) {
  if (reportModule[exportName] !== coreModule[exportName]) {
    throw new Error(`Report adapter does not preserve core identity: ${exportName}`);
  }
}

const registryBeforeReactImport = globalThis.customElements;
await import(
  `${pathToFileURL(controlsReactPath.pathname).href}?artifact-check=${Date.now()}`
);
if (globalThis.customElements !== registryBeforeReactImport) {
  throw new Error('Importing the React controls adapter mutated customElements.');
}

// A module evaluated without HTMLElement cannot later be registered against a
// newly installed DOM: its Lit base belongs to the inert import-time realm.
// Reject this explicitly rather than silently creating an HTMLUnknownElement.
const lateDom = new JSDOM();
const lateGlobals = {
  window: globalThis.window,
  document: globalThis.document,
  HTMLElement: globalThis.HTMLElement,
  customElements: globalThis.customElements
};
try {
  globalThis.window = lateDom.window;
  globalThis.document = lateDom.window.document;
  globalThis.HTMLElement = lateDom.window.HTMLElement;
  globalThis.customElements = lateDom.window.customElements;
  let lateDefineFailure;
  try {
    controlsModule.defineSurfViewControlsElement();
  } catch (error) {
    lateDefineFailure = error;
  }
  if (!(lateDefineFailure instanceof Error) ||
      !lateDefineFailure.message.includes('imported after the current DOM realm')) {
    throw new Error('DOM-less controls import did not reject late registration.');
  }
  if (lateDom.window.customElements.get('surfview-controls')) {
    throw new Error('Late registration mutated the CustomElementRegistry.');
  }
} finally {
  lateDom.window.close();
  for (const [name, value] of Object.entries(lateGlobals)) {
    if (value === undefined) {
      delete globalThis[name];
    } else {
      globalThis[name] = value;
    }
  }
}

const coreBrotli = brotliCompressSync(core).byteLength;
const reportBrotli = brotliCompressSync(report).byteLength;
const controlsBrotli = brotliCompressSync(controls).byteLength;
const controlsReactBrotli = brotliCompressSync(controlsReact).byteLength;
process.stdout.write(
  'controls artifact audit passed: ' +
  `core=${coreBrotli} B, report=${reportBrotli} B, controls=${controlsBrotli} B, ` +
  `controls-react=${controlsReactBrotli} B Brotli\n`
);
