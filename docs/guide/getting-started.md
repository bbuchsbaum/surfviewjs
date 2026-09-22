# Getting started

This guide gets one typed surface onto a browser canvas, explains who owns each
resource, and points to the real-file path.

## Requirements

- A modern bundler that understands ESM
- A browser with WebGL
- Node.js 22 or newer for package installation and build tooling

Install SurfView and its required Three.js peer:

::: code-group

```bash [npm]
npm install surfview three
```

```bash [pnpm]
pnpm add surfview three
```

```bash [yarn]
yarn add surfview three
```

:::

React is optional. Install `react` and `react-dom` only when using
`surfview/react` or `surfview/controls/react`.

## Add a host element

The application owns the container and its layout. Give it an explicit size:

```html
<div id="viewer" style="width: 800px; height: 600px"></div>
```

## Create the first viewer

The following is the repository's canonical quickstart. The documentation gate
links this page and the README to the same source file; the packed-consumer gate
then compiles that file in strict TypeScript against the result of `npm pack`.

<<< ../../examples/quickstart.ts

The geometry has three vertices and one face so it is self-contained. A
`DataLayer` maps one scalar value per vertex through `coolwarm`. Registering the
surface schedules an on-demand render, so no permanent animation loop is
needed.

The viewer owns the registered surface, canvas, renderer, event subscriptions,
and scheduled frames. The `pagehide` handler releases them with the idempotent
`viewer.dispose()` operation.

## Move to cortical data

Use `loadSurface()` to obtain a `SurfaceGeometry` from GIFTI, a FreeSurfer
triangle surface, or the supported ASCII PLY subset. Construct and register a
surface only after loading resolves:

```ts
import { loadSurface, MultiLayerNeuroSurface, SurfaceLoadError } from 'surfview';

try {
  const geometry = await loadSurface('/surfaces/lh.pial.gii');
  const cortex = new MultiLayerNeuroSurface(geometry, { baseColor: 0xb8bec8 });
  viewer.addSurface(cortex, 'left-cortex');
} catch (error) {
  if (error instanceof SurfaceLoadError) {
    console.error(error.code, error.stage, error.format);
  }
}
```

The loader validates dimensions, finite coordinates, face indices, encodings,
size limits, timeout, and cancellation before returning. See [Surfaces](./surfaces.md#loading-surfaces)
for exact formats, laterality precedence, Node parsing, and failure behavior.

## Choose the next guide

- [Quick start](./quick-start.md) — adapt the canonical example to sizing,
  loading, layers, and cleanup.
- [Layers](./layers.md) — add scalar, label, RGBA, connectivity, temporal, or
  volume-projection data.
- [Viewer](./viewer.md) — camera, anatomical views, events, scheduling, and
  ownership.
- [First-party controls](./controls.md) — mount opt-in DOM or React controls.
- [Reliability and contracts](./reliability.md) — package formats, loader and
  numerical semantics, and evidence limits.
