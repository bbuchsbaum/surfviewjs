# Quantitative flatmaps and relief

Import the optional feature from `surfview/flatmap`; anatomy, workers, colormaps and the legacy view remain in `surfview`. The optional ESM entry shares core class identities and registries without duplicating the viewer.

A quantitative flatmap interpolates **scalar values before applying a color map**. `FlatMapChart` keeps cut display triangles separate from the complete anatomical `SurfaceDomain`. `FlatMapSampler` prepares reusable vertex or volume sampling weights. `FlatMapController` owns frame revisions, cancellation and byte-bounded tile caches. Canvas2D provides a reference renderer; WebGL2 and `FlatMapSurfaceBinding` present the same sampled field in 2D and 3D.

Try **Anatomy & views → Flat map** in the demo. It uses matched real pycortex S1 white, pial, inflated and flat surfaces. Signals and missing regions are constructed, explicitly labeled examples. The admitted chart excludes documented inverted/overlapping faces and duplicates one cut vertex while retaining its original anatomical ID. The source checkout's `demo/data/flatmap/README.md` and `manifest.json` record provenance and checksums for the [pinned S1 data](https://github.com/gallantlab/pycortex/tree/1e4c0790b66bcbcd836b5832650908f83327c399/filestore/db/S1/surfaces).

Choose **Volume** to enable **Ribbon depth**. Surface vertex values and chart distortion have no depth dimension, so the control is disabled in those modes. The demo volume contains fixed synthetic spatial waves that make changes across the ribbon visible; the analytical benchmark retains its separate affine reference field. Yellow selection pins remain visible through folds, including when the selected point lies on the far side of the folded view. Click either view to move the shared pin, or click empty map space to clear it.

## Connect a chart and scalar source

The Anatomy chapter contains this type-checked public-API example. `chart`, `pial`, and `white` must describe corresponding anatomy; `values` contains one value per original anatomical vertex. A cut chart may have additional seam copies.

<<< ../../examples/quantitative-flatmap.ts

Use `new CanvasFlatMapRenderer(presentation)` for a 2D reference without WebGL. A quantitative attachment borrows its controller and renderer; it does not dispose either. A surface binding borrows its field and anatomical snapshots. Dispose the view/attachment and surface before their shared controller/field. Injected workers and executors remain caller-owned. Workers start only when explicitly constructed.

`FlatMapChart` validates finite coordinates, face correspondence, component orientation, degeneracy and positive-area overlaps. Consistently reflected components are allowed. Touching boundaries are owned deterministically by the lowest chart-face index. Pixel centers run left to right and top to bottom. This boundary rule is also used by lookup and tiled rendering.

## Volume sampling and missing data

Create a `FlatMapSampler` with `kind: 'volume-scalar'`, matched `white`/`pial` metrics, `dims`, `voxelToWorld`, `frame`, and `depth`. The affine is column-major, voxels are x-fastest, and integer coordinates denote voxel centers. The volume and both anatomical metrics must declare the same millimetre frame; no registration is inferred.

Choose `depth: { fraction: 0.5 }` for one point, or `depth: { interval: [0.2, 0.8], samples: 8 }` for an equally weighted midpoint sample mean. This is **not volume-weighted ribbon integration**. `interpolation` is `linear` by default, or `nearest`. The existing [ribbon integration API](./surface-geometry.md#ribbon-columns) answers a different question.

Results distinguish outside-chart, out-of-volume, missing-data, insufficient-coverage and valid samples. Zero is valid. Zero-weight contributors do not invalidate a sample. Trilinear interpolation requires every positive-weight voxel in that individual stencil. Explicit `{ missing: 'renormalize', minCoverage: 0.5 }` can average valid depth samples; it does not fill missing corners inside an invalid trilinear sample. Vertex scalars can renormalize valid barycentric weights under the same explicit policy. Default minimum coverage is one.

`controller.inspect(location)` returns the exact anatomical-location value, coverage, geometric coverage, depths and source contributions. This query is independent of raster resolution. The screen displays discretized pixel samples; do not report a pixel value as an exact-location measurement without distinguishing the two.

## Frames, presentation and linked inspection

Construct a replacement `FlatMapFrame` when values or validity change. Frames own their buffers and have content fingerprints. Reuse the same sampler for a new frame to preserve cached geometric weights. Changing depth, affine or anatomy requires a new sampler. Palette, threshold and relief changes do not request new sampling plans.

`controller.select(location)` stores a canonical `SurfaceLocation` and emits `selection`. A FlatMapView attachment selects triangle interiors; `viewer.pickSurfaceLocation()` returns the corresponding original face/weights from 3D. Pass that location to the controller. Hover remains transient. Use `viewer.annotations.addAnchor()` for a persistent mark. Seam vertices have multiple display copies; triangle locations identify a particular face, while a vertex anchor uses its first retained copy.

`FlatMapSurfaceBinding` drapes the same pixel field over the chart's retained 3D faces. It shares the LUT, threshold, support mask and nearest-pixel sampling. Nearest sampling deliberately avoids interpolation across invalid pixels and cut boundaries; it can show pixel steps at low resolution. This opt-in path leaves existing vertex-color surfaces unchanged. Faces excluded from the chart are absent from the binding; add a separately owned anatomical underlay mesh if the application needs complete uncut anatomy.

The optional anatomical grayscale underlay is a presentation array set with `renderer.setAnatomy(shade)` (one finite value in [0,2] per raster pixel). It never changes numerical samples. The demo derives it from prepared anatomical folding height. Coverage hatching remains independent of map opacity.

## Relief and distortion

`buildSurfaceRelief()` derives a raw folding cue from matched white/pial distance and lumped area ratios. It optionally regularizes log height with a positive area-weighted Gaussian on the cut chart, then computes slopes. `buildSurfaceReliefInWorker(worker, ...)` runs the same kernels off the main thread. The method is named `log-gaussian-relief-v1`; it is not pycortex's screened-Poisson smoother. Broad smoothing can be expensive, even with bounded retained storage.

Arbitrary chart units need explicit calibration. `flatMapAreaCalibration(chart, pial)` matches total represented areas for display; it does not make local distances anatomical. `surface.setDeformation(fold, exaggeration, shading)` interpolates the anatomical endpoint toward the calibrated sheet. Relief displacement is gated by `fold`. Exaggeration is bounded to [0,20]. Anatomy, sampling locations and metrics remain immutable. A shared shader function and synchronized CPU pick proxy keep rendering, GPU picks, CPU raycasts and attachments on the displayed surface.

`computeFlatMapDistortion(chart, metric)` returns per-face chart/anatomical area ratio, globally normalized relative area ratio, and anisotropy (largest/smallest singular value). These describe the chart mapping, not statistical uncertainty. The demo's continuous distortion colors are explicitly labeled vertex averages of log₂ relative area; use the returned face arrays for exact diagnostic values.

## Export and budgets

`exportFlatMap(controller, presentation, { width: 1024, label, provenance })` returns PNG and JSON blobs from an independent snapshot. The PNG is an **unlit quantitative map**, with a color key and coverage labeling. The sidecar records chart/frame fingerprints, volume metrics/affine/depth when applicable, missingness policy, palette and supplied provenance. Relief and user ROI artwork are not baked into this quantitative export. ROI SVG and anatomical label-GIFTI remain separate exports.

Default controller retention is 64 MiB, split 75% plans and 25% numeric tiles. Default renderer allocations are capped separately at 128 MiB; worker retained resources use the existing 256 MiB total / 128 MiB per-resource limits. Surface construction preflights CPU arrays plus an estimate for expanded face picking. These are explicit component budgets, not a bound on all JavaScript objects or browser/GPU driver memory. Applications with multiple views should budget their combined resources.

A large full-frame scan may exceed the plan cache: warm frames then rebuild evicted tiles. The performance receipt reports this rather than promising full-frame reuse or 60 fps. Chart/topology validation includes synchronous setup; use workers for expensive preparation and avoid constructing large charts during pointer movement. The controller streams tiles and cancels superseded results. Read `controller.diagnostics` and `worker.diagnostics()` for retained-resource evidence.

See the [implementation plan](../architecture/quantitative-flatmap-relief-plan.md) for contracts and the repository's `benchmarks/2026-10-28-flatmap/` for measured results and visual specimens. Qualification applies to the recorded fixtures and browser, not arbitrary cortical flattenings or clinical interpretation.
