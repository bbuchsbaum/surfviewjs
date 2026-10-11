# SurfView.js API

The canonical API reference is generated from the public TypeScript source and
is published with the documentation site:

- [Generated API reference](https://bbuchsbaum.github.io/surfviewjs/api/)
- [Getting started](docs/guide/getting-started.md)
- [Reliability and contracts](docs/guide/reliability.md)

TypeDoc runs with source error checking enabled and treats warnings as build
errors. The package-consumer gate separately installs a clean `npm pack`
archive, checks every export path, executes ESM and CommonJS imports where
supported, and compiles strict downstream TypeScript without skipping dependency
declarations.

## Entry points

| Import | Public role |
| --- | --- |
| `surfview` | Core viewer, surfaces, layers, loaders, serialization, events, and numerical utilities |
| `surfview/react` | React viewer and `useNeuroSurface` hook |
| `surfview/controls` | Opt-in host-mounted DOM controls |
| `surfview/controls/react` | React controls adapter |
| `surfview/report` | Portable report-scene mounting and manifest types |

The root supports ESM imports and the 2.x CommonJS/UMD compatibility build. The
optional entry points are ESM. `three` is a required peer; React and React DOM
are optional peers used only by React entry points.

## Stable boundaries

- Viewer construction requires a browser DOM and WebGL. Importing the core and
  using pure utilities does not construct a viewer.
- `SurfaceGeometry`, loader inputs, viewer configuration, layer mutations, and
  serialized numeric state are validated before observable mutation.
- `loadSurface()` failures expose typed `code`, `stage`, and `format` fields.
- `viewer.dispose()` is idempotent and releases viewer-owned DOM, scheduler,
  event, surface, renderer, and WebGL resources.
- `tToZ(t, df)` preserves signed Student-t cumulative probability; it is not a
  `z = t` approximation. See the [scientific contract](docs/guide/reliability.md#statistical-semantics).

## Appearance

- **Lighting.** `NeuroSurfaceViewer` config `headlight` (default `true`) holds
  the key and fill lights fixed relative to the camera; `viewer.setHeadlight(enabled)`
  changes it explicitly, and `viewer.acquireHeadlight(enabled)` takes a
  temporary, nestable override and returns its release function (report scenes
  use it). Preset light intensities give a camera-facing surface ≈π irradiance,
  i.e. layer colours at their nominal values. See
  [Lighting and colour](docs/guide/viewer.md#lighting-and-colour).
- **Colour management.** Layer, colormap and hex colours are display (sRGB)
  values; composited surfaces decode them to linear before lighting. The
  material colour of a composited surface is white; `baseColor` colours the
  base layer only. Style presets recolour the base layer only while it still
  shows the default or previous preset colour;
  `MultiLayerNeuroSurface.resetBaseColor()` returns it to preset control.
- **Curvature underlays.** `computeMeanCurvature(geometry, { smoothingIterations })`
  (mean curvature in 1/mesh units, FreeSurfer sign: positive in sulci) for
  folded surfaces; `computeSulcalDepth(geometry, { scale, tolerance, maxIterations })`
  (sulc-like depth in mesh units, positive deep) computed on the folded surface
  for inflated and flat displays. Depth costs about O(V^1.5): ~70 ms at 10k
  vertices, ~1.7 s at 164k, ~13 s at 655k, so compute it once and keep it.
  `CurvatureLayer` (and `curvatureToGrayscale`) draw gyri light and sulci dark;
  `invert: true` reverses the ramp. See
  [CurvatureLayer](docs/guide/layers.md#curvaturelayer-anatomical-underlay).

For exact signatures and referenced types, use the generated reference rather
than copying declarations from this overview.
