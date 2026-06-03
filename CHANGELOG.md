# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
