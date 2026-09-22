# Quick start

This page shows how to adapt the verified first example without changing its
ownership model.

## Canonical example

Create an application-owned `<div id="viewer"></div>`, then use:

<<< ../../examples/quickstart.ts

This exact file is compiled in strict mode against a clean `npm pack` archive.
It deliberately uses tiny in-memory arrays; the viewer and layer APIs are the
same for a cortical mesh.

## Size and resize

Pass positive CSS-pixel dimensions to the constructor. If the host changes
size, resize the viewer from the application's layout observer:

```ts
const observer = new ResizeObserver(([entry]) => {
  if (!entry) return;
  const { width, height } = entry.contentRect;
  if (width > 0 && height > 0) viewer.resize(width, height);
});
observer.observe(container);
```

Disconnect host-owned observers during application teardown. `viewer.dispose()`
cleans up viewer-owned resources, but it cannot remove an observer the host
created.

## Replace the sample geometry

`SurfaceGeometry` accepts finite XYZ triples and integer triangle indices. For
network data, prefer the validated loader:

```ts
const geometry = await loadSurface(
  '/subjects/S01/lh.pial.gii',
  'auto',
  'unknown',
  30_000,
  false,
  100,
  { signal: abortController.signal, maxBytes: 100 * 1024 * 1024 }
);
```

Explicit laterality wins, followed by valid file metadata and then an
unambiguous filename token. If none is available, laterality remains `unknown`.
A failed or aborted load returns no geometry and does not mutate a viewer.

## Add an overlay

`DataLayer` accepts dense values when `indices` is `null`, or sparse values with
an explicit vertex-index array. A dense layer must provide one value per
surface vertex before compositing:

```ts
const activation = new DataLayer(
  'activation',
  vertexValues,
  null,
  'coolwarm',
  { range: [-5, 5], threshold: [-1.96, 1.96], opacity: 0.85 }
);
surface.addLayer(activation);
```

Layer mutations request a coalesced render. Call `viewer.render()` only when an
immediate synchronous paint is specifically required.

## Optional controls

The first-party panel is a separate ESM entry and an ordinary DOM sibling of
the canvas:

```ts
import { mountSurfViewControls } from 'surfview/controls';

const controls = mountSurfViewControls(viewer, controlsContainer, {
  theme: 'auto',
  density: 'compact'
});

// During host teardown:
controls.dispose();
viewer.dispose();
```

Mounting does not add scene objects, move the camera, or rearrange the host
page. See [First-party controls](./controls.md) for React, report targets, and
feature selection.

## Continue

- [Surfaces](./surfaces.md) for formats and geometry invariants
- [Layers](./layers.md) for ordering, updates, and compositing
- [Viewer](./viewer.md) for lifecycle and interaction
- [Reliability and contracts](./reliability.md) for the enforced boundaries
