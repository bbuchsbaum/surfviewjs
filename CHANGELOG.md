# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [2.3.0] - 2026-10-09

### Added
- `projectVolume(volume, surface, options)` samples a scalar volume along
  anatomical surface normals and returns per-vertex values with valid-sample
  counts, without creating a layer, texture or DOM element. It has explicit
  contracts for voxel-centre coordinates, masks, nearest/linear interpolation
  and `mean`/`max-abs` reduction; see the layers guide and
  `docs/performance/volume-projection.md`. A Normal Volume Projection demo
  scenario and `npm run benchmark:volume` accompany it.
- `NeuroSurfaceViewer.fitToView({ padding, surfaceId })` (also on the React
  handle) frames the visible surfaces, or one surface, in the current viewing
  direction for perspective and orthographic cameras. Its clipping planes
  cover the scene throughout the zoom range, so later orbit and dolly do not
  clip.
- Report scenes gain an `anatomical` layout (`mountSurfView(..., { layout:
  'anatomical' })`): both hemispheres keep their RAS placement, separated only
  by `hemisphereGap` at the midline, and whole-brain presets (`left`, `right`,
  `left-medial`, `right-medial`, `dorsal`, `ventral`, `anterior`, `posterior`,
  `oblique`) rotate the brain rigidly. Medial presets hide the other
  hemisphere. The default `split` layout is unchanged.
- `oblique: 'auto'` picks, per displayed map, the oblique angle that faces the
  most suprathreshold cortex (`chooseInformativeOblique`); explicit
  `{ azimuth, elevation }` angles are also accepted.
- `fitInsets` / `setFitInsets` frame the brain inside the part of the canvas
  left free by overlaid controls (principal-point shift, orbit target
  unchanged); camera fitting now uses exact per-vertex perspective bounds.
- Thresholded data layers draw their threshold as an anti-aliased per-fragment
  isoline with an optional outline band (`DataLayer.writeThresholdEdgeAttributes`,
  `MultiLayerNeuroSurface.setShading`), plus optional silhouette darkening and
  partial overlay emission.
- `report` style preset: sulcal two-tone underlay, camera-attached key and fill
  lights, silhouette darkening, heat colormaps for thresholded statistics.

### Fixed
- Threshold edges were anti-aliased symmetrically about an interpolated
  distance to the threshold, so vertices just below threshold took a faint
  partial colour (dotted "ghost rings" around sub-threshold patches) while
  whether a vertex just above it was coloured depended on its neighbours.
  The edge attribute now carries each vertex's visibility sign, placing the
  contour midway between a shown and a hidden vertex, and the shader's ramp is
  one-sided: no colour on the hidden side, at least half colour on the shown
  side. Every vertex is now drawn exactly as the per-vertex colormap mask says.
- CPU picking returned the first registered surface hit along the ray rather
  than the nearest, so hovering a front hemisphere could report the hidden one
  behind it.
- CPU picking ray-cast hidden surfaces too, so in a medial view (which hides
  the other hemisphere between the camera and the one on screen) hovers and
  clicks reported the hidden hemisphere. CPU and GPU picking now consider only
  surfaces that are drawn: visible themselves and through every ancestor, on a
  camera layer, and with at least one visible material
  (`isObjectDrawn` in `utils/Picking`).
- Opaque surfaces rendered with `depthWrite: false`, so wherever a closed
  inflated surface overlapped itself on screen (the insula seen from above, a
  frontal fold seen head-on) far-side triangles painted over near-side ones as
  cracks and hatching. Fully opaque composites now render opaque with depth
  writes.
- The curvature and base layers created by the `MultiLayerNeuroSurface`
  constructor were never wired to change events, so runtime curvature
  brightness/contrast/smoothness changes (including style presets) were
  silently ignored.
- Report mounts resized to the container's own height instead of the stage's
  stale `min-height`, which cropped the brain when a CSS-sized frame narrowed.
- PNG figure export defaulted to a transparent background for the `report`
  preset (whose viewer is opaque) and keyed every figure with a generic
  viridis "Value" colour bar whatever the layer's colormap. Report figures are
  now opaque, and without an explicit choice export uses the live viewer
  background colour (as set by `setFigureBackground`) rather than the preset's.
  The new `background` option (`'viewer'`, `'transparent'` or `0xRRGGBB`)
  overrides `transparent`/`backgroundColor`. The colour key now describes the
  active layer (or `colorbarLayer`): its colormap, display range, label and
  units, the masked threshold interval as a striped band with its bounds, and
  cap triangles where its data extend beyond the colour scale; see
  `NeuroSurfaceViewer.getFigureColorbarSource`, `DataLayer.sampleColorMap` /
  `getColorKeyRange` (dual-threshold statistical maps key both scales; volume
  projection layers are keyed too) and `ColorMap.getUnmaskedColor`.

- Restored legacy `dist/neurosurface.*` bundle aliases and UMD source maps for
  downstream `neurosurf` htmlwidget/pkgdown sync targets that still consume the
  historical artifact names.
- Explicit style options (background, lighting, rim, SSAO, metalness,
  roughness) now take precedence over a style preset passed in the same
  constructor or `updateConfig()` call, and are recorded in
  `viewer.stylePreset` so later surfaces inherit them. A colour-only
  `updateConfig({ backgroundColor })` keeps the current transparency, and
  `ssaoKernelSize` now updates at runtime.
- `setZoom()` beyond the controls' zoom range widens that range and the far
  plane instead of clipping the scene or being snapped back by the controls.
- `VolumeProjectionLayer` rejects unknown `sampling` modes and ribbon
  `reducer`s instead of silently using a different computation. Its CPU
  sampling now shares the `projectVolume` core and is bit-identical to the
  previous implementation.

### Changed
- Removed unused Gulp, Webpack CLI, `node-fetch`, direct Rollup 2 plugins, and
  their stale package scripts; application and package builds now use Vite 8
  with Rolldown, while VitePress retains its isolated Vite 5/Rollup 4 stack.
- Publish source maps only for the core ESM/UMD bundles and their required
  `neurosurface.*` compatibility aliases. Optional entries and the self-contained
  embed no longer duplicate source content in the archive.

- `updateMaterials()` (run by `updateConfig({ metalness, roughness })`) no
  longer replaces surface materials with `MeshPhysicalMaterial`, which
  discarded each surface's material type, double-sided rendering, opacity and
  shininess, and replaced the shader materials of GPU-composited and
  volume-projected surfaces. It now updates each surface through its own
  configuration, so viewer `metalness`/`roughness` affect `standard` and
  `physical` surface materials only; set `materialType` on a surface to use
  them with the default Phong material.

### Security
- Added an exact dependency-audit gate: the published runtime must remain free
  of advisories, critical development findings are rejected, and the remaining
  VitePress-nested Vite advisory is narrowly allowlisted with a dated review.
- Updated development dependencies (Vue 3.5.43, source-map-js 1.2.2 and patch
  releases in the VitePress toolchain) for GHSA-g2v6-rqmx-r4w6 and
  GHSA-68fv-2mgg-jv7q. The published runtime dependencies are unaffected.

## [2.2.0] - 2026-06-03

First release published to npm.

### Added
- The active colormap name is now tracked and reported honestly.
  `ColorMappedNeuroSurface.getColorMapName()` returns the preset name (e.g.
  `'jet'`) when created from a named preset, or `'custom'` for an
  externally-supplied color array / `ColorMap` instance. The viewer's colormap
  dropdown is seeded from the colormap actually applied, so a custom palette no
  longer masquerades as a preset that was never applied.

### Internal
- Added an ESLint gate (ESLint 9 + typescript-eslint) wired into CI, and
  resolved the violations it surfaced (braced `case` declarations, removed a
  no-op `try/catch`, empty interface → type alias) with no behavior change.

## [2.1.0] - 2026-06-03

First tagged release; hardened for npm publishing.

### Added
- Parcel-native layers, parcel connectivity surfaces, and graph visual
  primitives with a topology demo.
- `ConnectivityLayer` and `StatisticalMapLayer`, plus state serialization and
  layer change notifications.
- Temporal playback engine with `TimelineController`, `SparklineOverlay`, and
  hover crosshair integration.
- GPU-based vertex picking (`GPUPicker`) and GPU-accelerated surface morphing.
- 2D colormaps for bivariate visualization.
- Slice-plane clipping for surface visualization.
- Curvature underlay support for anatomical context.
- `LICENSE` file (MIT).

### Changed
- `surfview/react` now ships a compiled ESM bundle (`dist/surfview.react.es.js`)
  instead of raw `.jsx`/`.ts` source, so the React subpath works in consuming
  bundlers without extra transpile configuration.
- Published package now contains `dist/` only (source is no longer shipped), and
  library bundles ship without sourcemaps or declaration maps to keep the
  tarball small.

### Removed
- Legacy `neurosurface.*` duplicate bundles are no longer produced or published.

### Fixed
- Transparent RGBA returned for masked colormap values; transparent alpha
  preserved in `DataLayer`.
- Stabilized the GPU picker crosshair selection.

[Unreleased]: https://github.com/bbuchsbaum/surfviewjs/compare/v2.3.0...HEAD
[2.3.0]: https://github.com/bbuchsbaum/surfviewjs/compare/v2.2.0...v2.3.0
[2.2.0]: https://github.com/bbuchsbaum/surfviewjs/compare/v2.1.0...v2.2.0
[2.1.0]: https://github.com/bbuchsbaum/surfviewjs/releases/tag/v2.1.0
