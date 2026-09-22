# Performance

SurfView performance depends on the mesh, layer count, update pattern, canvas,
device pixel ratio, browser, driver, and GPU. This guide explains the levers;
the [benchmark report](../performance/benchmark-report.md) records the exact
workloads, runner, repetitions, dispersion, memory, and checked ceilings.

## Read the evidence first

The repository benchmarks 32,492, 163,842, and 324,002 vertices with 1, 4, and
8 layers. Node measurements cover CPU compositing and texture preparation.
Browser measurements call `gl.finish()` after each measured draw, so they
include submitted WebGL work rather than JavaScript dispatch alone. Picking,
dirty updates, reorder, visibility, resize, memory, and bundle size have
separate results.

Those values are regression evidence for named synthetic workloads. They are
not a guaranteed frame rate for a user's anatomy or hardware. Profile the
application's actual mesh and interaction path before choosing a compositor or
render size.

## On-demand rendering

Ordinary viewers do not keep a permanent animation frame alive. Mutations call
`requestRender()`, and repeated invalidations before the next frame are
coalesced:

```ts
surface.updateLayers([
  { id: 'activation', opacity: 0.7 },
  { id: 'uncertainty', visible: false }
]);
viewer.requestRender();
```

Use `viewer.render()` only when a synchronous paint is required. Trackball
interaction temporarily schedules follow-up frames while the pointer or damping
is active, then settles to zero. `stopRenderLoop()` explicitly pauses automatic
rendering; `startRenderLoop()` resumes it and requests one frame.

## CPU and GPU compositing

Request GPU compositing when constructing a multi-layer surface:

```ts
const surface = new MultiLayerNeuroSurface(geometry, {
  useGPUCompositing: true
});

viewer.addSurface(surface, 'brain');
console.log(surface.getCompositingMode()); // 'GPU' or 'CPU'
```

The request is not a promise that the GPU path will activate. SurfView checks
the attached renderer's WebGL2, texture-unit, texture-size, and filtering
capabilities. Unsupported configurations remain on, or return to, CPU
compositing.

On the GPU path, changing data in one layer can regenerate and upload only that
layer's array-texture slice. Hiding, showing, or reordering a layer can move
later visible layers between shader slots, so those relocated slices are also
regenerated. Measure the operation your application actually performs; a dirty
data update and a full reorder are different workloads.

CPU compositing remains the compatibility path. It writes the final per-vertex
RGBA buffer and uploads that color attribute. It can be the simpler and faster
choice for a small number of infrequently changing layers.

## Volume projection

`VolumeProjectionLayer` samples a 3D volume texture on the GPU when WebGL2 and
the required texture capabilities are present. Range, threshold, colormap, and
opacity changes update uniforms or small lookup textures. Replacing
`volumeData` uploads the complete 3D texture.

Float32 texture storage is approximately `nx * ny * nz * 4` bytes before driver
overhead. Half-float data halves the texture payload but requires conversion and
the corresponding filtering support. Keep high-frequency volume replacement
out of an interaction loop unless measurements on the target hardware support
it.

## Canvas and framebuffer cost

Framebuffer work grows with rendered pixels, not surface vertices. Pass CSS
pixel dimensions to the viewer and resize only when layout changes:

```ts
const actual = viewer.resize(width, height, {
  dpr: window.devicePixelRatio
});
console.log(actual.dpr); // positive and capped at 4
```

SurfView caps device pixel ratio at `MAX_DEVICE_PIXEL_RATIO` (`4`) to bound
framebuffer allocation. Applications can choose a lower DPR for large canvases
or constrained devices. Effects and physically based materials should be
evaluated visually and measured on the intended renderer; do not select them
from generic speed labels.

## Memory and cleanup

Layer arrays, composite buffers, geometry attributes, GPU array textures, and
volume textures are distinct allocations. The benchmark report accounts for
the arrays it owns and reports texture backing separately; browser and driver
overhead is outside that accounting.

Removing a registered surface by ID disposes it. Disposing the viewer clears all
registered surfaces and viewer-owned GPU resources:

```ts
viewer.removeSurface('temporary');

// Final application teardown:
viewer.dispose();
```

Do not call `surface.dispose()` again after `removeSurface(id)`. Clean up
host-owned observers, timers, and controls handles separately.

## Reproduce and diagnose a regression

```bash
# Deterministic Node matrix and emitted provenance
npm run benchmark:performance

# Checked Node ceilings against an existing build
npm run benchmark:check

# Synchronized Chromium WebGL matrix
npm run benchmark:browser
```

Compare medians, median absolute deviation, minima, and maxima. Reproduce a
failure on the same runtime, identify whether it is CPU work, texture bytes,
shader execution, picking, resize, or runner noise, and collect repeated hosted
runs before changing a ceiling. A local pass is not hosted or release proof.
