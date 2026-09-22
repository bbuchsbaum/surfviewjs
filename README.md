# SurfView.js

[Guide](https://bbuchsbaum.github.io/surfviewjs/) ·
[API reference](https://bbuchsbaum.github.io/surfviewjs/api/) ·
[Demo](https://bbuchsbaum.github.io/surfviewjs/demo/) ·
[npm](https://www.npmjs.com/package/surfview)

SurfView.js is a TypeScript library for rendering interactive cortical surfaces
in the browser. It keeps mesh geometry, ordered data overlays, scientific color
mappings, picking, and temporal playback in one typed viewer model built on
Three.js.

Use it when a neuroimaging application needs to own its page and data flow while
SurfView owns the canvas, scene, and GPU resources. Rendering is on demand by
default, and optional controls mount into a container supplied by the host
application.

> **Runtime boundary:** construct a viewer only in a browser with WebGL. The
> package declares Node.js 22 or newer for build tooling and server-side imports;
> GPU rendering remains a browser responsibility.

## Install

```bash
npm install surfview three
```

`three` is a required peer dependency. React is optional and is needed only for
the `surfview/react` or `surfview/controls/react` entry points.

## Quick start

Add `<div id="viewer"></div>` to the page, then run the following as a browser
module. The small triangle makes the example self-contained; replace its typed
arrays with a loaded cortical mesh for real data.

<!-- example:quickstart:start -->
```ts
import {
  DataLayer,
  MultiLayerNeuroSurface,
  NeuroSurfaceViewer,
  SurfaceGeometry
} from 'surfview';

const container = document.querySelector<HTMLElement>('#viewer');
if (!container) throw new Error('Expected a #viewer element.');

const geometry = new SurfaceGeometry(
  new Float32Array([-1, -1, 0, 1, -1, 0, 0, 1, 0]),
  new Uint32Array([0, 1, 2]),
  'left'
);
const surface = new MultiLayerNeuroSurface(geometry, { baseColor: 0xb8bec8 });
surface.addLayer(new DataLayer(
  'activation',
  new Float32Array([-2, 0, 2]),
  null,
  'coolwarm',
  { range: [-2, 2] }
));

const viewer = new NeuroSurfaceViewer(container, 800, 600, { preset: 'paper-light' });
viewer.addSurface(surface, 'left-cortex');

window.addEventListener('pagehide', () => viewer.dispose(), { once: true });
```
<!-- example:quickstart:end -->

Adding the surface schedules one coalesced frame; a permanent animation loop is
not required. `viewer.dispose()` releases listeners, surfaces, controls,
post-processing objects, renderer resources, and the WebGL context.

This exact example is compiled in strict mode from a clean packed-package
consumer. Continue with [loading a real surface](docs/guide/surfaces.md#loading-surfaces)
or the [guided first workflow](docs/guide/getting-started.md).

## What it covers

- Load validated GIFTI, FreeSurfer triangle, and supported PLY surface files.
- Compose scalar, RGBA, label, outline, connectivity, volume-projection, and
  temporal layers in an explicit order.
- Pick vertices, synchronize 2D flatmaps, annotate surfaces, and coordinate
  bilateral anatomical views.
- Mount opt-in DOM or React controls without putting UI state in the Three.js
  scene graph.
- Export portable report scenes with manifest-backed labels, units, legends,
  provenance, and displayed-map policy.

## Package entry points

| Import | Use | Published format |
| --- | --- | --- |
| `surfview` | Core viewer, surfaces, layers, loaders, and utilities | ESM plus the 2.x CommonJS/UMD compatibility build |
| `surfview/react` | React viewer and hook | ESM |
| `surfview/controls` | Host-mounted scientific controls | ESM |
| `surfview/controls/react` | React controls adapter | ESM |
| `surfview/report` | Portable report-scene mounting | ESM |

The package exports declarations for every entry point. Optional React and
controls code is kept out of the core entry and has independent bundle budgets.
See [Reliability and contracts](docs/guide/reliability.md) for exact runtime,
loader, numerical, lifecycle, and performance boundaries.

## Fit and boundaries

SurfView is a good fit for browser applications that already have cortical
geometry and vertex-aligned data. It does not perform registration, statistical
model fitting, or scientific calibration. Its statistical helpers have narrow,
documented estimands; for example, `tToZ(t, df)` preserves the signed Student-t
cumulative probability and is not a large-sample substitution of `z = t`.

WebGL is required. Features that need WebGL2 or particular texture capabilities
report unsupported hardware or use a documented CPU path. Loader limits and
validation protect the application boundary, but applications still decide
which URLs and data are trusted.

Performance numbers are workload- and runner-specific. The repository publishes
the exact meshes, layer counts, synchronization method, memory accounting, and
checked ceilings in its [benchmark report](docs/performance/benchmark-report.md)
instead of claiming a universal frame rate.

## Documentation

- [Getting started](docs/guide/getting-started.md) — install, render, load, and
  clean up a first viewer.
- [Surfaces](docs/guide/surfaces.md) and [layers](docs/guide/layers.md) — data
  contracts and compositing workflows.
- [Viewer lifecycle](docs/guide/viewer.md) — ownership, scheduling, interaction,
  and disposal.
- [First-party controls](docs/guide/controls.md) — DOM, React, and report-control
  boundaries.
- [Reliability and contracts](docs/guide/reliability.md) — package formats,
  scientific semantics, failure behavior, and evidence limits.
- [Generated API reference](https://bbuchsbaum.github.io/surfviewjs/api/) — public
  symbols and declarations from the current source.
- [CI policy](docs/testing/ci-policy.md) — required local and hosted gates.

## Development

```bash
npm ci
npm run type-check
npm run type-check:demo
npm test
npm run docs:build
```

The full release candidate also runs strict public type contracts, clean
packed-package consumers on Node 22 and 24, coverage thresholds, bundle and
performance budgets, Chromium WebGL tests, and macOS visual regression. See the
[CI policy](docs/testing/ci-policy.md) for the distinction between local evidence
and hosted release proof.

## License

[MIT](LICENSE)
