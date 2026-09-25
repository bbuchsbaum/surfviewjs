# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
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
- CPU picking returned the first registered surface hit along the ray rather
  than the nearest, so hovering a front hemisphere could report the hidden one
  behind it.
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

### Changed
- Removed unused Gulp, Webpack CLI, `node-fetch`, direct Rollup 2 plugins, and
  their stale package scripts; application and package builds now use Vite 8
  with Rolldown, while VitePress retains its isolated Vite 5/Rollup 4 stack.
- Publish source maps only for the core ESM/UMD bundles and their required
  `neurosurface.*` compatibility aliases. Optional entries and the self-contained
  embed no longer duplicate source content in the archive.

### Security
- Added an exact dependency-audit gate: the published runtime must remain free
  of advisories, critical development findings are rejected, and the remaining
  VitePress-nested Vite advisory is narrowly allowlisted with a dated review.

### Fixed
- Restored legacy `dist/neurosurface.*` bundle aliases and UMD source maps for
  downstream `neurosurf` htmlwidget/pkgdown sync targets that still consume the
  historical artifact names.

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

[Unreleased]: https://github.com/bbuchsbaum/surfviewjs/compare/v2.2.0...HEAD
[2.2.0]: https://github.com/bbuchsbaum/surfviewjs/compare/v2.1.0...v2.2.0
[2.1.0]: https://github.com/bbuchsbaum/surfviewjs/releases/tag/v2.1.0
