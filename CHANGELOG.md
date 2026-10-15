# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [3.1.0] - 2026-10-15

### Added
- Persistent binary anatomical references in portable v2 report scenes, with
  independent visibility and opacity, categorical boundaries, and reset defaults.
- Custom color arrays and `ColorMap` instances for `VolumeProjectionLayer`,
  including CPU/GPU palette lookup, alpha, and saved mapping state.
- `projectRibbonVolume()` for standalone white-to-pial sampling with voxel
  masks and valid-sample counts, without WebGL.
- `parseGIfTIScalars()` for per-vertex scalar GIFTI data, including compressed
  payloads, multiple maps, and missing values.

### Changed
- The Volume demo offers a custom signed palette; scalar demo data now uses
  the public GIFTI parser.

## [3.0.0] - 2026-10-10

### Upgrading from 2.x
No API was removed, but default output changes. Each change has an opt-out:
- Surfaces look different: colours are decoded from sRGB once, `baseColor`
  no longer tints overlays, and lights follow the camera. Pass
  `headlight: false` for world-fixed lights.
- `computeMeanCurvature` returns resolution-independent mean curvature
  (FreeSurfer sign, smaller magnitudes), and `CurvatureLayer` renders gyri
  light. Pass `invert: true` for the 2.x shading; FreeSurfer `.curv` data now
  displays the conventional way without it.
- GPU volume projection samples nearest voxels by default. Pass
  `sampling: 'linear'` for smooth maps.
- `ResolvedNeuroSurfaceViewerConfig` has a required `headlight` field.
- States saved by 2.3.0 restore their key-light position only into a viewer
  with `headlight: false`.

### Added
- `REPORT_BRAIN_VIEWS` and `DEFAULT_REPORT_OBLIQUE` are exported from the
  root entry and `surfview/report` (with the `ReportBrainView` and
  `ReportObliqueAngle` types on the report subpath).
- `ParcelPuzzleView` options `background` and `previewBackground`; its
  stylesheet reads `--sv-parcel-puzzle-*` custom properties whose fallbacks
  are the previous values.
- `SparklineOptions.cornerRadius`, `shadow` and `className`.
- `FlatMapView` option `fit: 'contain' | 'stretch'`.
- `GPUPicker.pick(..., { throttle: true })` (and `pickNDC`) for hover-driven
  callers; `GPUPickOptions` is exported.
- `VolumeTexture3D` `filter` option, `setFilter()` and `getFilter()`.
- `computeSulcalDepth(geometry, { scale?, tolerance?, maxIterations? })`:
  FreeSurfer `sulc`-like depth (mm, positive deep, median-centred) measured
  below a smoothed envelope of a folded surface; r = 0.96 against FreeSurfer
  `lh.sulc` on fsaverage5. Smoothing is two implicit steps solved by
  conjugate gradients, O(V^1.5) (measured under vitest: ≈70 ms for
  fsaverage5, ≈0.2 s at 41k vertices, ≈1.7 s at 164k, ≈13 s at 655k);
  a solve that reaches `maxIterations` warns. It works in coordinates centred
  on the mesh, so the result does not depend on where the mesh sits in space,
  and it ignores vertices that belong to no face (depth 0). Use it,
  computed on the folded mesh, as the underlay of inflated and flat surfaces.
  `MeanCurvatureOptions` and `SulcalDepthOptions` are exported.
- `CurvatureLayer` and `curvatureToGrayscale` option `invert`;
  `CurvatureLayer.setInvert()`; `invert` in `curvatureOptions`,
  `setCurvature()` options, `LayerUpdate` and the `curvature` registry factory.
- Viewer option `headlight` (default `true`) and `viewer.setHeadlight()`.
  Saved viewer state records `config.lighting.headlight`, and restores it
  through `setHeadlight()`; while the headlight is on, the key light's world
  position is neither saved nor restored. States saved by 2.3.0 have no
  `headlight` field but do carry `directionalPosition`; restoring one into a
  viewer whose headlight is on (the default) leaves the headlight on and drops
  that position, because it is ambiguous (2.3.0's report layout also saved
  camera-tracked positions). Turn the headlight off first to restore a 2.3.0
  world key position. `viewer.acquireHeadlight(enabled)` takes a nestable
  temporary override and returns its release function; an explicit
  `setHeadlight()` supersedes all live overrides. Type-level change:
  `ResolvedNeuroSurfaceViewerConfig` (`Required<NeuroSurfaceViewerConfig>`)
  gains a required `headlight: boolean`, so code that builds a complete
  resolved config object must add it.
- `CurvatureLayer.fromStateJSON()` and `BaseLayer.fromStateJSON()` (with
  `BaseLayer.getColor()`): viewer-state restore now applies saved curvature
  `brightness`, `contrast`, `smoothness` and `invert` and the base-layer colour
  (previously ignored). Both are validated with the rest of the state before
  anything is applied, so an invalid value fails the restore without moving the
  camera or applying earlier layers.
- `MultiLayerNeuroSurface.applyStyleBaseColor()` and `resetBaseColor()`: the
  surface records the base colour last applied by the default or a style
  preset, and a preset recolours the base layer only while it still has that
  colour. A colour chosen any other way — constructor `baseColor` or `color`,
  `updateConfig({ color })`, `updateLayer('base', …)`, `updateLayers`,
  `BaseLayer.setColor`, restored state — survives presets;
  `resetBaseColor()` hands the base back to preset control. The constructor
  now honours `color` as well as `baseColor` for the base layer.

### Changed
- **Behaviour change (appearance): colour management.** Composited colours are
  now decoded from sRGB to linear before lighting, on the CPU path (in the
  surface shading patch, vertex and threshold-edge colours) and the GPU path
  (after `compositeLayers()`), so the renderer's sRGB output encoding is
  applied once instead of brightening and flattening every colour. Layer and
  composite buffers still hold display (sRGB) values; legacy
  `ColorMappedNeuroSurface` writes linear colour attributes. Hex-anchored
  colormaps (`coolwarm`, `bwr`, `seismic`, `rdylbu`, `spectral`, `blues`, …)
  are now interpolated in sRGB like generated colormaps, `LabelLayer` writes
  sRGB components, and `GPULayerCompositor.setBaseColor()` stores sRGB
  components. Screenshots and pixel read-backs of every surface change.
- Connectivity edges convert colormap colours from sRGB to linear (line
  vertex colours and tube instance colours), so they match the colour key and
  the surface overlays; `getEdgeColors()` still returns display values.
- `VolumeProjectedSurface` (`VolumeProjectionMaterial`) decodes colormap
  texels to linear and encodes its output with the renderer's output colour
  space, so the base colour is no longer drawn too dark and overlays match the
  composited surfaces. Its lighting remains its own fixed view-space light
  (ambient + one light about 30° off the line of sight), not the scene's
  lights; `headlight` and preset intensities do not affect it.
- **Behaviour change (appearance): no material tint.** A vertex-coloured
  surface's material colour is white. `baseColor` (and `updateConfig({ color })`
  on `MultiLayerNeuroSurface`, including from style presets) now sets the base
  layer's colour only; previously it also multiplied every layer, curvature and
  data overlays included, darkening them and tinting them towards the base
  colour (twice where the base layer showed). The GPU compositing material's
  diffuse colour is white likewise.
- **Behaviour change (appearance): camera-attached lighting by default.** The
  key and fill lights follow the camera (`headlight: true`), so the visible side
  of the cortex is always key-lit; with world-fixed lights a lateral view of the
  left hemisphere faced away from the key light and was lit only by ambient and
  fill. `headlight: false` restores the world-fixed rig. Default and preset
  light intensities are retuned for three.js physically based lighting (a
  camera-facing surface receives ≈π irradiance, showing layer colours at
  nominal value: ambient + 0.956·key + 0.854·fill ≈ π for the key ≈17° and
  fill ≈31° off the line of sight): default ambient `0xffffff` × 1.0, key
  1.84, fill 0.45 (was ambient `0xb5b5b5` × 1.25, key 1.6, fill 0.8);
  `ambientLightColor` and `directionalLightIntensity` defaults change
  accordingly. The report scene controller now uses the viewer's headlight
  instead of its own render listener. It still enables it for the anatomical
  layout and leaves world-fixed lights for split, but the light geometry
  changed: the key and fill are now aimed at the orbit target from fixed
  camera-space directions (key `(0.35, 0.5, 2)`, fill `(-0.8, -0.3, 1.4)`)
  rather than placed at offsets from the camera position (previously
  `(0.4, 0.6, 0.8)` and `(-0.5, -0.3, 0.6)`), so report renders are lit
  slightly more frontally. It holds its setting as a nestable override
  (`acquireHeadlight`) that it releases on dispose, so disposing one report
  does not undo another live report's lighting, and a user's explicit
  `setHeadlight()` outlives both.
- **Behaviour change: curvature sign and estimator.** `CurvatureLayer` and
  `curvatureToGrayscale` take FreeSurfer-convention input (positive in sulci)
  and render gyri light, sulci dark (`gray = brightness − scaled · contrast`);
  pass `invert: true` for the previous mapping. `computeMeanCurvature` keeps
  the FreeSurfer sign but projects the umbrella vector onto the area-weighted
  normal and divides by the squared mean edge length, giving mean curvature
  in inverse mesh units independent of resolution (≈ −1/R on a sphere; r = 0.87
  against FreeSurfer `lh.curv` on fsaverage5, was 0.81), with 2 smoothing
  passes by default (`smoothingIterations`). Values are smaller in magnitude
  and differently distributed than before; pass them through
  `normalizeCurvature` as before.
- Demo: pial chapters use the new mean curvature; inflated displays (Layers,
  Parcels & connectivity, Anatomy › Inflate and the flat-map sheet) use sulcal
  depth measured on the folded surface — for fs_LR 32k from the shipped
  `tests/data/fs_LR.32k.L.sulcal_depth.shape.gii` (90 KB, computed on the HCP
  midthickness), since curvature computed on the inflated mesh only showed
  noise. The blue-grey `baseColor` is gone, and the Layers chapter's additive
  activation uses opacity 0.5 over a `[0, 2.2]` range so it no longer clips to
  white on light gyri.
- Style presets retune curvature display (`brightness`, `contrast`,
  `smoothness`) for the new estimator and gyri-light mapping, and the
  `presentation` preset sets `overlayEmission: 0.25` so overlay hues stay
  saturated on slopes facing away from the key light.
- `VolumeProjectionLayer` `sampling` now also sets the GPU vertex path's 3D
  texture filter. The default `sampling` is still `'nearest'`, so GPU vertex
  projection without an explicit `sampling` now samples nearest voxels instead
  of interpolating; pass `sampling: 'linear'` for the previous look. Where
  `OES_texture_float_linear` is unavailable, float textures fall back to
  nearest filtering.
- The GPU compositing material is built on three.js's Phong shader: it follows
  the scene's lights and the surface's material settings like the CPU path,
  and supports threshold edge shading. Its private `ambientLight`,
  `directionalLight` and `lightDirection` uniforms are gone; light the scene
  instead.
- `new VolumeTexture3D(..., { magFilter: THREE.NearestFilter })` without a
  `minFilter` now samples nearest in both directions (minification used to
  stay linear); pass `minFilter` explicitly for a mixed setup.
- `FlatMapView` preserves the map's aspect ratio by default (`fit:
  'contain'`); `fit: 'stretch'` restores per-axis scaling.
- `NeuroSurfaceViewer.fromURL()` accepts a full URL string, a `URL`, a hash or
  a bare `svjs=` fragment.
- Explicit `GPUPicker.pick()` calls are no longer throttled; only picks that
  request `throttle` are, and those reuse the latest result instead of
  reporting a miss.
- `annotations.activate(id, { exclusive: false })` keeps earlier annotations
  in their active colour.

### Fixed
- `VolumeProjectionLayer.update()` accepts `colorMap`, the field every other
  scalar layer's `update()` takes, so one `updateLayer(..., { colorMap })`
  call recolours data and volume layers alike. It previously threw "does not
  support field: colorMap" (and `DataLayer` rejected `colormap`), which left
  the volume demo's colormap select without effect. The older `colormap`
  spelling still works; passing both with different values throws.
- GPU picks near a triangle edge no longer miss: the ID buffer samples the
  pixel centre while the ray passes through the exact cursor, so the ray could
  just miss the visible face and return no vertex. Such picks now use the
  ray's crossing of that face's plane.
- `disableGPUPicking()` now falls back to CPU raycasting instead of returning
  no hit.
- `setAnatomicalView(..., { layout: 'paired', hemisphereGap })` applies the
  gap: each hemisphere's medial edge, measured from its displayed vertices,
  sits `hemisphereGap / 2` from the midline.
- Per-annotation `colorOn` / `colorOff` are honoured.
- Hover picking runs a trailing update, so the last pointer position is not
  dropped.
- `MorphableSurface` morph targets are relative (they no longer collapse the
  mesh toward the origin) and carry morph normals.
- `StatisticalMapLayer.getVertexStatInfo().zScore` keeps the statistic's sign
  when p-values are supplied (p-values are two-sided; F stays unsigned).
- Report mounts pass manifest label, units and legend to their layers, so
  exported colour keys carry the map label.
- `<surfview-controls>` shows the layer's colormap and the current style
  preset on first render instead of the first option.
- Surface clip planes on the GPU compositing path keep the same side as the
  CPU path (they previously kept the opposite side) and clip the morphed
  surface. `GPULayerCompositor.setClipPlanes` now drives
  `material.clippingPlanes`; the `clipPlane*` uniforms are gone.
- Figure exports place annotation labels at their markers when a surface has
  been moved.
- Annotation markers: markers added before the manager switched to instanced
  drawing are recoloured on activation; `setDefaults()` colours repaint
  existing markers that have no colours of their own; instanced drawing no
  longer draws unused slots at the surface origin, grows past its initial
  capacity instead of dropping markers, stops drawing removed markers, and
  keeps its culling bounds current as markers are added or moved.
- `VolumeTexture3D` keeps explicit `minFilter`/`magFilter` options through a
  linear-filtering fallback (and falls back when either needs linear
  filtering) until `setFilter` replaces them.
- `GPULayerCompositor.dispose()` releases its references to layers and their
  volume textures.

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

[Unreleased]: https://github.com/bbuchsbaum/surfviewjs/compare/v3.0.0...HEAD
[3.0.0]: https://github.com/bbuchsbaum/surfviewjs/compare/v2.3.0...v3.0.0
[2.3.0]: https://github.com/bbuchsbaum/surfviewjs/compare/v2.2.0...v2.3.0
[2.2.0]: https://github.com/bbuchsbaum/surfviewjs/compare/v2.1.0...v2.2.0
[2.1.0]: https://github.com/bbuchsbaum/surfviewjs/releases/tag/v2.1.0
