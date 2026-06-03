# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed
- `surfview/react` now ships a compiled ESM bundle (`dist/surfview.react.es.js`)
  instead of raw `.jsx`/`.ts` source, so the React subpath works in consuming
  bundlers without extra transpile configuration.
- Published package now contains `dist/` only (source is no longer shipped).
- Library bundles are published without sourcemaps and declaration maps to keep
  the tarball small.

### Removed
- Legacy `neurosurface.*` duplicate bundles are no longer produced or published.

### Added
- `LICENSE` file (MIT).

## [2.1.0] - 2026-06-03

First publishable release.

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

### Fixed
- Transparent RGBA returned for masked colormap values; transparent alpha
  preserved in `DataLayer`.
- Stabilized the GPU picker crosshair selection.

[Unreleased]: https://github.com/bbuchsbaum/surfviewjs/compare/v2.1.0...HEAD
[2.1.0]: https://github.com/bbuchsbaum/surfviewjs/releases/tag/v2.1.0
