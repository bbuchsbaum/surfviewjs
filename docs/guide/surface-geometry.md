# Surface geometry and computation

Surface geometry APIs separate **vertex correspondence**, **anatomical measurements**, and **display positions**. Morphing a mesh does not change a measurement metric. Import everything below from `surfview`; no numerical dependency or worker starts on import.

`SurfaceDomain` owns triangle indices and compact adjacency. Its ID, structure, vertex count and ordered topology identify correspondence. `SurfaceMetric` owns finite, nondegenerate anatomical positions in a named millimetre frame. Constructors copy input buffers; accessors return copies. Build a new metric when anatomy changes. Rejecting malformed geometry is different from returning an unsupported output sample.

## A runnable example

This small synthetic fixture exercises all six directions. It runs in Node as well as the browser and checks two analytic results. It is not participant data.

<<< ../../examples/surface-geometry.ts

## Borders, paths and attachments

- `OutlineLayer` keeps its existing `transition-edges` default. Set `boundaryMode: 'midpoint'` for borders between categorical regions. Two-label faces use midpoint cuts; three-label faces meet at the centroid. The parcel fill builder uses the same partition. Background is explicit (`backgroundLabel`, default zero); negative label IDs are preserved.
- `buildSurfaceBoundaryGraph()` owns labels, shared interfaces and stable location IDs. `updateLabels()` updates incident faces after validating the complete edit. `traceBoundaryCurves()` preserves holes, open ends and junctions. `boundaryCurveToEditable()` makes an independent control curve; moving it does not silently relabel the atlas. `evaluateSurfacePolyline()` produces local XYZ coordinates for export or rendering.
- `GeodesicIndex` offers radius queries, multi-source distances, paths, ROI dilation and erosion. `edge` searches mesh edges; the default `triangle-pair` also crosses an unfolded pair of triangles. Both are graph approximations to continuous geodesic distance. `shortestPathLocations()` connects triangle-interior endpoints through virtual vertices. Path locations include shortcut crossings, so drawing them follows the surface. Data-guided vertex paths accept penalties in [0,1]; missing penalties are barriers. Physical length and penalized cost are separate.
- `viewer.pickSurfaceLocation()` uses a CPU triangle hit, including current GPU morph positions. It returns an additive `location` alongside the legacy vertex result. GPU vertex IDs remain suitable for vertex hover; they do not establish barycentrics.
- `viewer.annotations.addAnchor(surfaceId, { location })` and `moveAnchor()` preserve precise attachments through morphs. Marker instances are grouped by surface and radius. Call `bindSurfaceDomain(mesh, domain)` to explicitly assert correspondence with a pre-existing computation domain. Otherwise a mesh gets a session-local domain. Equal vertex counts do not establish correspondence.
- `exportSurfaceAnchors()` / `importSurfaceAnchors()` store topology identity, weights, offset value/frame and metadata in a separate artifact. `remapSurfaceLocation()` requires an explicit vertex correspondence and a matching target triangle. Portable viewer scenes retain their existing vertex annotation representation; save precise anchors separately. Linked viewers do not infer an anchor mapping.

Offsets use a face normal for triangle anchors and an area-weighted incident normal for vertex anchors. Display offsets are display units; metric offsets require a `SurfaceMetric`. An undefined normal is an error. Apply `matrixWorld` only when exporting world display coordinates.

## Areas, smoothing and descriptive clusters

`computeVertexAreas()` assigns each triangle's area equally to its three vertices. `summarizeSurfaceRegion()` names its estimand: `vertex-membership` sums these lumped areas, while `label-partition` integrates a piecewise-linear field over the actual categorical pieces. A singleton corner in a two-label triangle owns one quarter of that face under label partition, versus one third under vertex membership. Results expose total area, valid area, coverage, mean and integral.

`buildSurfaceSmoothingPlan()` builds a normalized area-weighted Gaussian with `sigma = FWHM / sqrt(8 ln 2)` and default cutoff 4σ. Zero FWHM is identity. `maskMode: 'support'` restricts contributors; `'barrier'` also restricts paths. Applying a plan renormalizes dynamic missingness and returns retained kernel coverage. Constant preservation does not imply area-integral conservation, or exact achieved FWHM on a curved irregular mesh. This method is not a Workbench smoothing port.

`StatisticalMapLayer.applyClusterAreaThreshold(threshold, { metric, minAreaMm2, signMode: 'separate' })` filters connected supra-threshold vertices using anatomical area. The existing vertex-count method remains available. Area filtering is descriptive; it does not calculate a cluster p-value. Opposite signs stay separate by default.

## Mapping scalar and categorical data

`SurfaceResamplingPlan` validates CSR offsets, indices, finite nonnegative weights, normalized row sums, coverage and memory bounds. Duplicate entries are coalesced and sorted. Scalar application defaults to strict missingness; `missing: 'renormalize'` is explicit. Coverage includes both construction-time ROI exclusion and runtime missingness. Label application votes by accumulated weight and resolves exact ties to the lowest numeric ID. Zero is valid data.

`exportSurfaceResamplingPlan()` writes little-endian uint32/float64 assets with a checksum and domain fingerprints. Import verifies identity, sizes, checksums and row contracts before returning a plan. Geometry fingerprints in constructed-plan exports identify the registered spheres and anatomical area metrics. An artifact is separate from portable viewer scene versions.

`buildSurfaceResamplingPlan()` requires source/target registered spheres with a named common correspondence frame, structure, center, radius and tolerance. It never infers registration from spherical shape. `barycentric-closest` uses an AABB index and Euclidean closest-triangle projection, including edge and vertex cases. `adaptive-barycentric-area` additionally uses forward/reverse support and positive anatomical areas. The default preserves double-precision closest-point semantics. An explicit finite-arithmetic profile is described below. Normalization is opt-in; registration is never inferred and there is no nearest-vertex fallback.

Plans reuse weights across frames. Synchronous smoothing and mapping `plan.apply(values, options, output)` accept exact-size Float64 values/coverage and Uint8 validity outputs, rejecting overlap with inputs or one another. Async generator applications allocate private outputs, preventing partial results from being published. Hosts own conversion into `DataLayer` buffers; retain a separate output when a temporal layer rewrites its input frame.

## Ribbon columns

`buildRibbonIntegrationPlan()` constructs barycentric dual columns between corresponding white/pial metrics. Each face becomes six prisms, split into tetrahedra using consistent shared-face diagonals. Inverted/collapsed tetrahedra and overlaps within a source face are rejected. This does not prove that an entire anatomical ribbon is globally disjoint.

The volume grid uses a column-major voxel-to-world affine, integer voxel centers, x-fastest values, a named common frame and millimetres. Convex clipping measures overlap with cells `[i−0.5, i+0.5]`. The result is a volume-weighted mean of a **piecewise-constant voxel field** over the specified tetrahedral model. Existing `projectRibbonVolume()` continues to sample line segments and returns sample counts.

Results expose total, in-grid and valid volumes in mm³, geometric coverage, valid coverage and status. Default minimum valid coverage is 1, with a 1e-12 numerical allowance; lowering it explicitly accepts partial columns. Invalid or absent support yields NaN. Optional destination `targets` restrict construction to selected columns, leaving other rows unsupported. Candidate-cell and byte budgets fail explicitly. This model has not been qualified as Workbench thin-column equivalence.

## Execution and ownership

Synchronous APIs are appropriate for small jobs and cached application. `GeometryExecutor.run(builderSteps, { signal, isCurrent, previewKey })` schedules the same generator kernels cooperatively. `isCurrent` guards result delivery against stale layers or frames. A new preview cancels the preceding job on that key; committed jobs omit it. Dispose executors when their owner is removed.

For background builds, create `GeometryWorkerClient` with an explicit `workerFactory`. The published `surfview/geometry-worker` export resolves to `dist/surfview.geometry.worker.js`; it is a module-worker asset, not a main-thread import. With Vite:

```ts
import workerUrl from 'surfview/geometry-worker?url';
import { GeometryWorkerClient } from 'surfview';

const worker = new GeometryWorkerClient({
  workerFactory: () => new Worker(workerUrl, { type: 'module' })
});
// Register a domain, register its metric, build a plan, apply repeatedly, release handles.
// Call worker.dispose() when the viewer/workspace owning it is disposed.
```

For UMD/embed or static hosts, copy the worker asset alongside the library and pass its served URL explicitly. Workers copy input buffers instead of detaching renderer storage. A factory-created worker is owned by default; `ownsWorker: false` leaves termination to its external owner. Releasing a metric/domain handle prevents new calls through that handle and defers reclamation while dependent plans remain retained. For repeated background brush queries, call `buildGeodesic(metricHandle)` once, then `withinRadius(indexHandle, seeds, radiusMm)`; the index retains its metric and is released explicitly after use.

Default geometry and plan byte budgets are 256 MiB and 128 MiB. Preflight estimates include temporary construction storage; large kernels may require a deliberately increased budget or a smaller target region. `smoothSurfaceValuesSteps()` provides a bounded row-at-a-time alternative when retaining all weights would exceed the budget; it uses the same neighborhoods and formula but recomputes them on each call. Oversized retained plans fail explicitly, so switching to streaming is a caller decision. Topology/index setup and some face-level kernels still contain synchronous sections; the scheduler's time slice is not a hard upper bound on those sections. Measure cancellation on the intended meshes before assigning an interactive latency guarantee.

Run `node --expose-gc scripts/benchmark-surface-geometry.mjs --output=/tmp/geometry.json` after `npm run build`. It records fixture/bundle hashes, runtime, hardware, construction/application timings, retained storage and cancellation. The synthetic benchmark explicitly grants 512 MiB for smoothing construction; it does not establish default-budget capacity or scientific acceptance on cortical data.

The existing Inspect and Anatomy chapters demonstrate precise attachments, a ruler and a midpoint brush. Statistics adds area filtering, Time series adds derived smoothing, Data in/out demonstrates mapping interchange, and Volume inspects selected column integrals. See the [implementation plan](../architecture/surface-geometry-plan.md) for the broader acceptance matrix and remaining qualification gates.

### Repeated frames with a shared validity mask

`SurfaceSmoothingPlan.prepare({ validity, missing, minCoverage }, budgetBytes)` copies a fixed validity mask and caches each row's denominator, coverage, and eligibility. `prepared.apply(values)` processes one frame; `prepared.applyBatch(frames)` processes 1–16 frames in 128-row tiles. Each result owns its values, validity and coverage arrays. The explicit budget includes the retained kernel, preparation storage and batch outputs.

Every contributor marked valid must be finite in every submitted frame. A nonfinite value at a valid contributor rejects the call; prepare a new mask or use ordinary `plan.apply()` when missingness changes. Excluded contributors may contain NaN. Preparation and application also expose cooperative `prepareSteps()` and `applyBatchSteps()` generators. With a `GeometryWorkerClient`, call `prepareSmoothing(planHandle, options)`, then `applyBatch(preparedHandle, frames, jobOptions)`. Releasing the original smoothing handle is safe after preparation: the prepared handle retains its dependencies until release. Cancelled or stale requests never return partial frames. Inputs are copied before queueing; output arrays are independently owned. Workers keep their default 128 MiB per-resource and 256 MiB total retained limits. An owned worker can receive explicit constructor `limits: { planBudgetBytes, budgetBytes }` for a larger workload; configuration completes before queued requests and becomes locked once resources or jobs exist. Shared externally owned workers cannot be reconfigured by the client. Construction budgets and worker retention budgets are separate checks.

```ts
const prepared = plan.prepare({ validity: sharedMask, missing: 'renormalize' });
const results = prepared.applyBatch(frames.slice(0, 16));
```

`SurfacePolyline` renders a depth-tested pixel-width stroke through surface locations. Call `updateBinding(binding)` when the display embedding changes, attach it to the corresponding surface mesh, and call `dispose()` when finished. Its display offset uses a shared-edge normal miter, bounded to four times the requested offset near foldbacks. This displacement affects drawing only. Categorical midpoint outlines use the same offset rule. Hidden portions remain occluded by intervening cortex. Label-crossing edges are a mesh diagnostic and can produce teeth or spurs.

The versioned [Workbench fixtures](../../benchmarks/workbench-parity-2026-10-27/receipt.json) compare nonconstant full and masked scalar maps on rotated analytic spheres. They qualify those fixtures only. The [cortical stress measurements](../../benchmarks/surface-geometry-cortical-tiled-2026-10-27.json) use fsaverage5 pial geometry and planar subdivisions; the denser meshes preserve that geometry rather than adding anatomical detail. Failed construction budgets and the earlier [slower batching layout](../../benchmarks/surface-geometry-cortical-2026-10-27.json) are retained. These measurements exclude browser transfer and GPU upload.

### Dense construction and external parity

Retained smoothing uses two passes: the first counts sparse support, and the second fills exact-size typed buffers. The validated kernel takes ownership of these fresh buffers, avoiding growing JavaScript arrays and a final full copy. Neighborhood searches run twice; this trades construction work for bounded assembly storage. Kernel weights, cutoff, distances and reduction order are preserved. Budget refusal remains explicit when the final kernel and construction scratch cannot fit.

Registered-sphere constructors accept `sphereNormalization: 'radius'` to normalize coordinates radially to the registration's declared center and radius. The default preserves supplied coordinates. Normalization is recorded in exported plan provenance and does not change the anatomical area metrics supplied for adaptive correction. A normalized build constructs its own triangle index. This option improves agreement on some templates but does not establish Workbench parity: near-edge support selection can differ even after normalization. Full-template failures and independent one-hot probes are retained in the qualification receipts.

The earlier [expanded qualification receipt](../../benchmarks/surface-geometry-dense-evidence-2026-10-27/receipt.json) covers four left-template up/downsampling routes, full/masked scalar and categorical fields, both resampling methods, and both normalization policies. Before the optional binary32 profile, radius normalization passed all 16 categorical comparisons, while scalar compatibility failed 10 of 16 fixed gates. Supported-row masks agree throughout. A retained one-hot probe distinguishes the near-edge support-selection difference from scalar output rounding. The receipt also records true fsLR 32k and fsaverage 164k cortical measurements, worker round trips, cancellation, construction failures, and the extra construction work required by exact allocation. These are qualification results, not a Workbench compatibility claim.


### Streamed batches with changing missingness

`smoothSurfaceBatch(metric, frames, smoothing, options)` and `smoothSurfaceBatchSteps()` accept 1–16 frames. Each neighborhood is constructed once per destination row and reused across the batch, then discarded. This avoids retaining the full sparse kernel, at the cost of rebuilding neighborhoods for each batch. `options.frameValidity` supplies one mask per frame; `options.validity` additionally excludes contributors in every frame. Nonfinite values and coverage follow ordinary smoothing semantics, including strict versus renormalized missingness.

```ts
import { smoothSurfaceBatch } from 'surfview';

const results = smoothSurfaceBatch(metric, frames, {
  fwhmMm: 8,
  budgetBytes: 128 * 1024 * 1024
}, { frameValidity: masks, missing: 'renormalize' });
```

`worker.smoothBatch(metricHandle, frames, smoothing, options, jobOptions)` runs the same streamed computation off the main thread. Frames and masks are copied before queueing. Every returned frame owns its outputs; stale or cancelled jobs publish no partial results. The budget includes owned inputs, outputs, masks, index and row scratch. It is an algorithm allocation bound, not a cap on JavaScript process RSS.

Full fsaverage 164k batches of three frames completed at both [4 mm](../../benchmarks/surface-geometry-stream164k-4mm-2026-10-27.json) and [8 mm](../../benchmarks/surface-geometry-stream164k-8mm-2026-10-27.json) under the 128 MiB algorithm budget, with full support and constant preservation within 5e-14. These are single cold runs: 331 s and 83 s respectively, under different host load. They establish capacity, not an interactive latency target or a comparison between widths. Process peak RSS was 355 MB and 409 MB, including parsing and other process allocations.

### Optional binary32 projection profile

Set both options explicitly for the qualified reference configuration:

```ts
const plan = buildSurfaceResamplingPlan(pair, {
  method: 'adaptive-barycentric-area',
  sourceAreaMetric,
  targetAreaMetric,
  sphereNormalization: 'radius',
  projectionProfile: 'binary32-chart-fma-v1'
});
```

This profile specifies a float32 orthonormal triangle chart, rounded residual half-space predicates, closed-edge projection, and ranking by distance to the reconstructed float32 point. Fused multiply/add uses binary32 round-to-even semantics, including an exact midpoint fallback. Positive interior weights are retained; there is no epsilon-based support deletion. Even an exact normalized source vertex can retain a tiny neighbor coefficient under this arithmetic; masking the dominant vertex can therefore leave support. The profile deliberately does not impose an exact-vertex shortcut. A conservative float-aware AABB bound keeps indexed selection consistent with exhaustive profile scoring in the regression fixtures. Chart storage adds 40 bytes per source triangle. The profile and normalization are retained in plan provenance. Default mapping remains unchanged.

The arithmetic specification was informed by reference source inspection and independent one-hot numerical probes of Workbench 2.2.1 on macOS ARM64, commit `01164ffa47f2778088bd6ff472ec9cd9a57f5b42`. It is not a general bitwise-compatibility guarantee for other Workbench versions, compilers, or inputs. The profile passed all 24 scalar and 24 categorical comparisons across six left-template routes (including two with anatomical area metrics), with identical supported masks and the declared exact-vote tie policy. Maximum scalar error was below 7e-7 against the unchanged 5e-5 gate. The [qualification record](../../benchmarks/surface-geometry-qualified-evidence-2026-10-27/README.md) retains the fixed scalar, label and support gates, exact-vertex and near-boundary witnesses, prior failures, and separate anatomical-area comparisons.

### Anatomical ribbon and browser measurements

Four complete incident-face patches from corresponding public fsaverage10k white/pial anatomy passed constant, support and missingness witnesses. Independent NumPy determinants agree with column volumes within 2.1e-16 relative error; three fixed-seed Monte Carlo integrations per column agree within six standard errors. This qualifies the specified tetrahedral model on those columns. Workbench thin-column values differ by up to 0.00133 at 16 subdivisions, with nonmonotonic refinement. These results do not establish estimator equivalence or whole-cortex anatomical validity. Inputs and independent reproduction code are retained in the [qualification record](../../benchmarks/surface-geometry-qualified-evidence-2026-10-27/README.md).

The [Metal browser receipt](../../benchmarks/surface-geometry-browser-metal-2026-10-27.json) records seven warmed 10k worker/render samples on Apple M3 Max. Worker round trips, display-buffer conversion, CPU render completion and combined GPU upload/draw time are measured separately. GPU elapsed queries ranged from approximately 0.26 to 0.65 ms. Distinct-frame masks matched retained-plan results exactly; cancellation and changing nonempty rendered pixels were checked. This is a short local measurement, not a delivered-frame-rate guarantee. The [software-renderer receipt](../../benchmarks/surface-geometry-browser-2026-10-27.json) has no GPU timer result. Both preserve outliers and raw samples.
