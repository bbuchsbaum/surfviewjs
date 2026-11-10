# Quantitative flatmaps and anatomical relief

Date: 2026-10-28. Status: implemented and locally qualified within the scope recorded in section 13. The original design below is retained; section 13 records delivery decisions that supersede proposed names or mechanisms. Nothing has been published or deployed.

Source baseline: SurfViewJS `a05f87fcd98a6e0c3766092b74a105bec10d44c6`, package 3.1.0. Inspiration: pycortex `1e4c0790b66bcbcd836b5832650908f83327c399`. Recheck the checkout and applicable instructions before implementation. Preserve the existing `.claude/settings.json`, `docs/architecture/cortical-evidence-plan.md`, and `output/` changes.

The user selected two capabilities: quantitative flatmap rendering and anatomical relief on flatmaps. They explicitly require a matched real flat/white/pial dataset for the visual demo. Synthetic fixtures support development and analytic tests; they do not satisfy anatomical acceptance.

## 1. Outcomes and scope

Deliver one coherent workflow: open a matched cortical surface, view a scalar map or sampled volume on a flatmap, inspect the same anatomical location in folded and flat views, and enable relief without changing the sampled data or anatomical measurements.

| Capability | Required outcome | Efficiency mechanism | Improvement over the borrowed idea |
| --- | --- | --- | --- |
| Quantitative flatmap | Scalar and volume-derived pixels, explicit missingness, linked inspection, temporal updates, PNG export | Reusable triangle lookup and sampling plans; visible tiles; separate sampling and coloring | Preserve source mesh topology; expose sampling footprint and coverage; consistent cut-aware correspondence |
| Anatomical relief | Smooth folding cues on a flat sheet, adjustable exaggeration, reliable picking and annotations | Worker preparation; cached height/slopes; GPU uniform updates | Independent distortion diagnostics; quantitative unlit mode; a common deformation contract across rendering and picking |

Required first-release scope: one active quantitative scalar or volume source, an anatomical underlay, an independent coverage overlay, ROI/selection overlays, frame replacement, and both CPU reference and WebGL2 presentation paths. Support both hemispheres in the contracts; a single matched hemisphere is the minimum real acceptance specimen.

Exclude cortical strips, new flattening algorithms, arbitrary bivariate/categorical layer stacks, statistical uncertainty inference, automatic cross-subject registration, report-schema migration, and WebGPU. Existing APIs remain usable. No new runtime numerical dependency, background service, or worker pool is needed. Publishing and deployment are separate from this implementation plan.

## 2. Current code and implications

| Existing seam | Verified behavior | Consequence |
| --- | --- | --- |
| [FlatMapView](../../src/FlatMapView.ts) | Canvas2D uniform triangle fills, ROI drawing, vertex events, linear vertex search; layer state is stored without quantitative painting | Preserve the facade and legacy drawing behavior; add a typed quantitative attachment backed by separate modules |
| [LinkedBrainWorkspace](../../src/LinkedBrainWorkspace.ts) | Links vertex hover/selection, forwards layer state and time | Add an optional precise-location/inspection capability; do not treat a crosshair update as a canonical selection event |
| [SurfaceDomain / SurfaceMetric](../../src/geometry/SurfaceDomain.ts) | Immutable owned snapshots, topology/geometry identities, anatomical mm units | Reuse anatomical identities; represent a cut chart separately instead of pretending its topology equals the complete surface |
| [SurfaceLocation](../../src/geometry/SurfaceLocation.ts) | Vertex and barycentric triangle locations | Use as the canonical identity across views, with explicit chart-to-anatomy correspondence |
| [GeometryExecutor](../../src/geometry/GeometryExecutor.ts), [worker protocol](../../src/geometry/geometryWorkerProtocol.ts) | Resumable kernels, cancellation, preview supersession, retained resources | Extend this execution path with typed feature commands; avoid a second job scheduler |
| [volumeProjectionCore](../../src/volumeProjectionCore.ts), [RibbonIntegration](../../src/geometry/RibbonIntegration.ts) | Point/segment sampling and volume-weighted integration are distinct operations | Reuse conventions and primitives, but give flatmap depth sampling its own named estimand |
| [GPULayerCompositor](../../src/GPULayerCompositor.ts) | Existing layer composition occurs in the vertex shader before interpolation/lighting | A new pixel scalar followed by a LUT is not automatically color-identical to this path; quantitative comparison needs an explicit shared sampled-field adapter |
| [MorphableSurface](../../src/MorphableSurface.ts), [DisplayGeometryBinding](../../src/geometry/DisplayGeometryBinding.ts) | Morph targets and CPU evaluation of drawn vertex positions | Extend through a bounded display-deformation adapter; relief cannot be a shader-only change |
| [GPUPicker](../../src/utils/GPUPicker.ts) | Separate face-ID mesh/shader using position attributes | Must consume the same deformation state as the visible mesh; otherwise relief produces incorrect hits |
| [Anatomy chapter](../../demo/chapters/anatomy.ts) | Already has linked flatmap, ROI drawing, and a hand-painted underlay | Upgrade the existing `mode=flatmap` workflow; extract mode helpers instead of enlarging the chapter indefinitely |

The existing demo's flat chart is generated from inflated fsaverage5, and its white surface in the Volume chapter is synthetic. Neither establishes the newly required matched real dataset. The former projection also uses map units, so its apparent equal-area property must not be presented as preservation of pial anatomical area.

## 3. Module boundaries

Use feature directories, small typed interfaces, and one owner for each state. The following files and public API names are proposed, not already available.

| Proposed module | Responsibility | Must not own |
| --- | --- | --- |
| `src/flatmap/FlatMapChart.ts` | Validated 2D chart, cuts, original-face mapping, coordinates and fingerprints | Data values, DOM, renderer state |
| `src/flatmap/FlatMapRasterPlan.ts` | Triangle binning, tile face IDs/barycentrics, pixel ownership | Volume frames, color palettes |
| `src/flatmap/FlatMapSamplingPlan.ts` | Vertex interpolation or depth-sample stencils, values, validity and footprint inspection | Lighting, camera, interaction state |
| `src/flatmap/FlatMapTileCache.ts` | Byte-accounted caches and eviction for raster, sampling, value and GPU tiles | Worker scheduling or another source of truth for data revisions |
| `src/flatmap/FlatMapController.ts` | Source/presentation snapshots, requested revisions, job lifetimes, selection | Numerical algorithms, app-specific controls |
| `src/flatmap/FlatMapRenderer.ts` | Small renderer contract with Canvas2D and WebGL2 implementations | Scientific sampling decisions |
| `src/flatmap/FlatMapSurfaceBinding.ts` | Optional shared sampled-field presentation on the folded/cut 3D surface | Legacy global layer semantics |
| `src/flatmap/FlatMapInspection.ts` | Canonical location, scalar/coverage readout, on-demand voxel footprint | Persisting UI-only hover as a saved ROI |
| `src/relief/SurfaceRelief.ts` | Pure relief preparation, method/version, validity and diagnostics | Display exaggeration and mutation of anatomy |
| `src/relief/FlatMapDistortion.ts` | Per-face area and shape distortion from chart and anatomical metric | Changing chart geometry |
| `src/relief/ReliefDisplayBinding.ts` | Height/slopes, deformation state, matching CPU/GPU evaluation | Recomputing anatomical metrics |
| `src/shaders/flatmapRelief.ts` | Shared GLSL position/normal evaluation for draw and pick passes | Independent numerical policy |

Keep `FlatMapView` as a backwards-compatible facade with an opt-in attachment. Its public canvas/ROI/event contracts remain intact: mount the quantitative renderer as a separate owned background surface and retain the existing overlay canvas. Adapt pointer-to-chart conversion once for zoom/pan so ROI drawing, painting and picking cannot drift apart.

Expose only the chart builder, sampling builder, controller/view attachment, inspection result, relief builder/binding, and distortion result needed by consumers through `src/index.ts`. Keep tile storage, worker handle details, shader patches and caches internal. Public demo imports must use `@src/index.js`; no private-field access, `as any`, or new broad viewer framework.

## 4. Scientific and identity contracts

### 4.1 Chart correspondence and cuts

`FlatMapChart` takes an anatomical `SurfaceDomain`, owned 2D chart coordinates, chart faces, one original vertex ID per chart vertex, and one original anatomical face ID per chart face. Seam duplication is allowed. Validate the three mapped corners against the original face, recording any corner permutation needed for barycentric conversion. Counts alone are insufficient.

One anatomical face may appear at most once in a chart in this release. Face omission is an explicit cut/mask. Original vertices may have multiple chart copies; surface-to-chart selection highlights all represented copies, and off-chart locations have a named `outside-chart` status. Anatomical ROI membership deduplicates seam copies. No new Delaunay triangulation, nearest-vertex remapping, or bridging of removed faces.

Validate finite coordinates, nonzero scale-relative triangle area, orientation consistency within connected chart components, and positive-area overlap. Consistently reflected charts are allowed with orientation metadata; local folds are rejected. Disconnected nonoverlapping components are allowed. Reject an ambiguous overlap rather than selecting the last rendered face. Use a spatial bin index to avoid an all-pairs overlap test. Tiny valid triangles are retained unless the documented degeneracy threshold excludes them.

Shared-edge pixel ownership is deterministic (a documented top-left raster rule plus stable face tie-break). Pixel centers, viewport origin, chart-axis convention, tile bounds, device-pixel ratio, and border inclusion are part of the raster contract. Raster coordinates never become anatomical mm coordinates implicitly.

Chart units are explicit. A chart in arbitrary units may support data rendering and relative distortion. Relief is prepared in anatomical mm, then mapped into display chart units through a declared calibration. Physical flat-chart smoothing needs that calibration. Whole-chart area normalization is a display convention, not evidence that the chart is anatomically isometric.

### 4.2 Values and volume sampling

Source descriptors are a discriminated union: `vertex-scalar` with anatomical-domain values, or `volume-scalar` with dimensions, voxel-to-world affine, frame ID, validity mask, white/pial metrics and depth policy. Snapshot mutable arrays once or accept an explicitly transferred owned frame. Never infer registration from array sizes or surface names.

For vertex data, interpolate raw scalar values with barycentric weights before applying thresholds and the LUT. Default missingness is strict over positive-weight contributors. Optional renormalization requires explicit `minCoverage`; zero-weight invalid contributors do not contaminate a valid sample.

For volume data, barycentrically interpolate white and pial coordinates for the selected original triangle. Sample the line between them in the registered volume frame. First release supports nearest and trilinear interpolation, a single fractional depth, or a mean over an explicit fractional interval. For an interval, use N equally weighted interior midpoint samples; N=1 is its midpoint. Fractions increase from white=0 to pial=1. Record interval, sample count and interpolation in every plan/export. This is a sample mean, not the volume-weighted ribbon integral and not equivolumetric laminar sampling.

Each trilinear sample is valid only if every positive-weight voxel contributor is finite and allowed by the mask, matching the numerical sampler's strict-stencil convention. Retain sample boundaries in prepared stencils: flattening everything into a normalized voxel row would silently change this policy. For the depth mean, renormalize over valid samples only when the selected missingness policy permits it and `minCoverage` is met.

Return separately: geometric coverage (fraction of planned samples with in-grid support), valid coverage (fraction of all planned samples that are usable), value, and status. Use `outside-chart`, `out-of-volume`, `missing-data`, `insufficient-coverage`, and `valid` statuses as appropriate. Missing data is not zero. A below-threshold finite value is still a valid measurement. Coverage is never encoded by changing the effect buffer.

Inspection evaluates the canonical location through the same sampler as the image and reports its actual depth parameters. A voxel-footprint query returns indices, spatial weights, depth weights, frame and mask status on demand; do not retain an object graph per pixel. A cached pixel readout must identify the pixel center it represents rather than masquerading as an exact arbitrary pointer location.

### 4.3 Relief and distortion

Start with independently implemented folding-height preparation inspired by pycortex:

`r = sqrt(A_pial / A_white)` and `h = thickness * (1 + r + r*r) / 3`.

Use anatomical lumped vertex areas and corresponding white-to-pial vertex distance. Compute raw quantities on the complete anatomical mesh, then map them into the cut chart; cutting must not change the anatomical area ratio. Invalid/degenerate support remains masked with diagnostics. Do not silently substitute a median height or clip numerical spikes without recording a policy.

Use the existing positive area-weighted Gaussian smoothing machinery on a cut chart metric for optional log-height regularization, with explicit scale and barrier semantics. Exponentiate, optionally remove a broader smooth trend while retaining the area-weighted mean, then compute slopes. Name the method `log-gaussian-relief-v1`. Pycortex uses a different screened-Poisson smoothing approach; matching its raw formula does not establish equivalence of the finished relief. Every smoothing scale, detrending choice, calibration and validity rule belongs in provenance. Bound broad-scale preparation using the streamed implementation when retained neighborhoods exceed budget.

Keep raw height, prepared display height and validity conceptually separate. This is an anatomical visualization cue, not a thickness estimator or reconstruction of the unfolded physical tissue. Exaggeration never enters data sampling or anatomical measurements.

Compute triangle height gradients in chart coordinates, then area-weighted vertex slopes. Store float32 `(height, slopeX, slopeY)` for GPU presentation; CPU preparation/reductions use float64. Reconstruct the height-field normal as `normalize(-s*slopeX, -s*slopeY, 1)` in the chart basis. This saves one float relative to pycortex's normal-plus-height attribute (12 versus 16 bytes per chart vertex), not 25% of total viewer memory. Conversion precision, seams and CPU pick storage must be measured separately.

Distortion is a separate diagnostic. For each face compute a local 2D Jacobian from the anatomical triangle to its chart triangle. Report area ratio and singular-value ratio (anisotropy). With uncalibrated chart units, report relative area ratio normalized by represented total anatomical/chart area; label it as relative. Reject folds/degeneracy before presenting a finite distortion color. Keep distortion in its own mode/legend; it cannot silently replace an active effect map.

## 5. Rendering, interaction and efficiency

### 5.1 Tiled flatmap pipeline

1. Build a chart-space spatial index once. Query candidate triangles for a tile and rasterize original faces into face IDs and barycentric coordinates.
2. Build only needed sampling tiles. Start at 128 by 128 pixels; configuration and budget tests determine a safe maximum. Direct on-demand sampling is the correctness baseline; prepared stencils are an optional reusable optimization.
3. Sample a frame in the worker/cooperative executor. Retain numeric values and explicit validity/coverage separately from colors.
4. WebGL2 uploads value/status/coverage tiles and applies the existing colormap/threshold semantics in a shared presentation adapter. Canvas2D uses the same CPU color semantics and bounded tile painting. Resolve sRGB conversion, straight/premultiplied alpha and transparent-edge behavior explicitly using existing compositing utilities.
5. Draw curvature/anatomy below the quantitative field, coverage hatching independently, then ROIs and marks. Quantitative mode is unlit. Optional shaded presentation is labeled and does not change the numeric legend/readout.
6. On pan/zoom, retain visible tiles plus a bounded halo, cancel obsolete work, and progressively replace lower-resolution tiles. Export requests exact output-resolution tiles and waits for that revision; it never silently exports a preview.

Full view means all visible tiles may eventually be needed. Tiling bounds working memory and improves latency; it does not guarantee less total work when all pixels are requested. Four times the linear export resolution produces sixteen times as many pixels. Export runs incrementally with explicit dimensions and a memory preflight.

Raster cache key: chart identity, resolution level, pixel grid convention and tile coordinates. Sampling key adds anatomical metrics, volume grid/affine, depth/interpolation policy and algorithm version. Value key adds frame/mask/missingness revisions. Presentation key adds LUT/range/threshold/opacity. Eviction is byte-based, and full keys guard against same-size but different geometry. Hash persistent inputs at registration/export, never during hover.

Changing a LUT/threshold must not rebuild a raster or sampling plan. Changing a frame must not rebuild geometry. Changing a validity mask must reapply sampling validity. Changing depth/grid/geometry invalidates affected sampling plans. Changing exaggeration must not invalidate any data or raster plan.

### 5.2 Consistency with 3D

The default existing 3D compositor interpolates colors produced at vertices. The new flatmap interpolates values before coloring. A nonlinear LUT or threshold makes these visibly different. Do not claim equality from shared vertex data alone or change all existing surfaces to a new rendering convention.

Provide an opt-in `FlatMapSurfaceBinding`: drape the same sampled scalar/coverage field over the corresponding cut 3D triangles, using chart coordinates, the same LUT, and explicit invalid-region rules. The chart cut defines which faces participate; the rest of the anatomy remains an underlay. Use guttered tile/atlas sampling and mask-aware filtering so values cannot bleed through cuts or no-data pixels. Both views use the same discretized field at a given resolution. Exact-location inspection remains a separate numerical query with the raster resolution reported when relevant.

Test a nonlinear LUT, a threshold inside a triangle, and partial support to establish this distinction. Legacy vertex-color layers remain available; their interpolated colors are not promised pixel parity with the new binding.

### 5.3 Relief deformation and picking

Use a dedicated cut-chart display mesh with explicit anatomical correspondence. At morph endpoints it uses anatomical/inflated positions or chart-plane positions; relief displacement is gated to the transition toward the flat chart. Do not attach a cut-face mesh to `bindSurfaceDomain` as if it had the complete domain's faces. The new adapter must map display faces to original `SurfaceLocation`s.

There is one immutable deformation snapshot/revision for morph parameters, chart basis, relief calibration and exaggeration. Shared GLSL evaluates the visible and GPU face-ID mesh positions. CPU position evaluation feeds annotations, crosshairs, face-hit refinement and exports. Surface layout transforms remain a separate final transform.

Three.js CPU raycasting cannot see arbitrary shader displacement. Provide a CPU pick proxy of evaluated positions with conservative bounds and revision checks; coalesce rebuilding when deformation changes, never per pointer move. Account for its indexed and GPU pick-expanded buffers. Commit GPU and CPU pick revisions together, or explicitly return a pending result until a matching proxy is ready; never return a stale hit. Idle relief uses cached geometry. Do not maintain two unrelated deformation formulas without differential tests.

A compact binding hook belongs in the existing picker and display-binding path. Avoid scattering shader conditionals through viewer, annotations and controls. On detach, restore the original material/picking behavior and release owned resources. Include clipping, surface visibility, context loss/restoration, morph endpoints and source replacement in this contract.

### 5.4 Worker, ownership and compatibility

Extend `GeometryWorkerClient` and the existing protocol with narrow commands/results for chart registration, raster/sampling tiles, frame registration/release and relief preparation. Register volume frames once rather than cloning a whole volume for each tile. Account for per-client and shared-worker memory; release dependent handles in order. A typed command-result map should cover the new commands rather than exposing unchecked casts to callers.

Use the same resumable kernels for synchronous tests, workers and cooperative fallback. Cancellation checkpoints occur inside long triangle, sample and smoothing loops. Reject stale results by source, parameter and destination revisions before upload. Preview supersession is scoped per controller. Never transfer a live renderer or caller-owned array. Default budgets start from the existing 128 MiB plan / 256 MiB executor limits, with renderer/GPU allocations reported separately and an explicit combined-view cap.

Do not spawn workers at import time. Disposal cancels jobs, unregisters snapshots, releases GPU textures/proxies and removes observers/listeners. An injected worker/executor remains caller-owned. Caches cannot keep disposed views alive. Repeated mounting and source switching must settle to the same retained-resource baseline.

Add typed attachment/update methods instead of interpreting arbitrary `layerState` records as a quantitative source. Retain existing vertex events; add precise-location events as an optional capability. Linking must reject incompatible domains and avoid echo loops. A selected original location survives a presentation change, while hover is transient. Audit the existing cortical-evidence plan before touching canonical selection interfaces so both features share the existing authority.

## 6. Matched real dataset: first acceptance dependency

Preferred candidate: the pycortex S1 example subject, whose documented database includes flat, white, pial and inflated surfaces. Its suitability is a candidate, not a verified fixture or a license conclusion. [Database documentation](https://gallantlab.org/pycortex/database.html).

The dataset milestone must:

1. Locate a complete source package at a pinned revision/archive and verify redistribution rights for the actual surface data, separately from software licensing. Record URL, checksum, subject/hemisphere, reconstruction/template provenance and units.
2. Verify white/pial topology and vertex correspondence, and explicitly map the flat chart's retained faces and any seam duplicates. Inspect excluded medial-wall geometry, orientation, self-overlap, degenerate faces and plausible thickness/area distributions. No silent repairs or nearest-neighbor registration.
3. Produce a reproducible conversion script and minimal demo asset bundle, preserving original identities and recording every conversion. Do not independently decimate variants; shared simplification, if necessary, needs a verified common mapping and separate distortion evidence. Prefer original resolution and lazy loading first.
4. Keep small analytic/regression fixtures in `tests/data/flatmap/`; place reusable licensed real demo assets and provenance under `demo/data/flatmap/`. Large originals belong in a documented external cache, with restoration checksums. Browser tests use deterministic local assets and do not fetch a live third-party dataset.
5. Use constructed, seeded scalar fields and registered synthetic volumes on this real anatomy to make expected values known. Label functional data as synthetic; geometry is real. A real functional dataset is optional and is not necessary to prove these features.

If S1's terms, size or geometry fail admission, select another documented matched subject/template package and repeat these checks. Do not substitute unrelated fsaverage5 and fs_LR files, a white surface synthesized from normals, or four local ribbon fans for whole-hemisphere acceptance. Update the existing product asset inventory as part of admitting the user-required dataset.

## 7. Visual demo

Extend **Anatomy & views → Flat map** (`/demo/index.html?scenario=anatomy&mode=flatmap`) and retain the `linked-flatmap` alias. Extract focused helpers under `demo/kit/` or an anatomy-mode subdirectory. Replace the chapter's hand-painted data underlay with public library APIs. Preserve the current reading-room lightbox design, film corners and margin controls; do not add a new gallery chapter or dashboard.

The first viewport shows a folded anatomical surface and a quantitative flatmap side by side with one shared color key. The initial synthetic scalar has a smooth gradient and a small known missing region, making value continuity and coverage visible immediately. Pinning a point prints the same anatomical location/value in both views.

The main demonstration sequence is:

1. **Map:** switch scalar/volume input; change range or threshold and see both views update without anatomical recomputation.
2. **Inspect:** click a point; show value, valid coverage and depth interval. Expand a compact depth-profile/voxel-footprint readout only for the pinned point. Move depth and see sampling change while the marked anatomy stays fixed.
3. **Relief:** switch the right-hand sheet to a slightly tilted relief view, preserving the selected location, range and ROI. Exaggeration changes folding cues. A persistent label says that relief is display-only.
4. **Distortion:** replace the right-hand data presentation with area/shape distortion and its own legend. Returning to Map restores the prior field and selection.
5. **Export:** save a full-resolution PNG with color key, source/method/depth/coverage metadata in an accompanying JSON sidecar. Figure captions distinguish real anatomy, synthetic data and relief exaggeration.

Use progressive disclosure: data source, depth, coverage and relief are primary controls; sampling resolution, preparation diagnostics and provenance are advanced. Put live values in existing film corners. Surface plain loading, preparing, ready, unsupported renderer, insufficient data and recoverable error states. Keep old valid content visibly marked as pending during replacement; never label it as the new result.

At narrow widths stack the paired views; controls remain reachable and the active point/readout stays visible. Use shared controls, keyboard-operable modes and a numeric anatomical vertex/landmark selector as an alternative to pointer selection. Coverage needs a pattern/status label, not color alone. Keep labels and legends readable at 200% zoom. Respect reduced motion; animation is optional and not needed to understand the comparison.

Visual evidence: fixed desktop 1440×900 and narrow 390×844 specimens, one mapped view, one coverage/depth view, one tilted relief view, and one distortion view. Use actual rendered output. Inspect desktop/narrow captures together, fix defects in one batch, then one confirmation pass. Visual approval requires readable values/legends, visible relief without color confusion, no cut bridges, and correctly attached marks; changing screenshot bytes is not sufficient.

## 8. Test strategy

Tests assert contracts and independent results, not copies of production loops. Small analytic cases belong in ordinary Vitest runs; real-data/browser and performance evidence have separate receipts.

| Area | Independent evidence and failure cases |
| --- | --- |
| Chart/raster | Hand-computed triangles and a two-triangle rectangle; exact corner correspondence; holes, duplicated seam vertices, reflected charts, disconnected pieces, overlap rejection, face permutation, tiny/degenerate faces; tile seams and pixel-center edge rules |
| Scalar sampling | Affine scalar fields reproduced by barycentric interpolation; constant preservation; source vertex permutation plus explicit remapping; NaN/zero-weight/mask cases; strict versus renormalized coverage; value zero remains valid |
| Volume sampling | Analytic constant and affine 3D fields; planar white/pial slab with known depth mean; rotated/translated/anisotropic/sheared affine grids; nearest half-voxel boundaries; out-of-grid endpoints/interiors; invalid contributors; mask changes; sample-count and depth reversal errors |
| Sampling semantics | Direct slow oracle with independently enumerated voxel corners versus prepared tiles; explicit check that depth-sample mean differs from volume-weighted ribbon integration on a nonuniform fixture |
| Cache/execution | Keys change for each scientific input; LUT/threshold/relief do not rebuild sampling; worker/cooperative/sync agreement; real worker cancellation during work; stale results, overlapping clients, release ordering, resource ceilings and disposal races |
| Relief | Parallel planar sheets yield raw height equal to separation; known area-ratio inputs check the formula; constant-preserving smoothing; explicit invalid support; independently computed finite-difference slopes; cuts prevent smoothing across removed edges; fixed-scale/dtype tolerances |
| Distortion | Identity and rigid transforms give ratio 1; uniform scale gives expected area factor and anisotropy 1; shear/stretch give known singular-value ratios; normalized area mode is invariant to chart units; folds/degeneracy are rejected |
| Deformation | Zero relief reproduces the flat chart; morph gating leaves folded endpoint unchanged; CPU positions and independently evaluated shader samples agree; canonical measurement/value/ROI identity is unchanged by exaggeration |
| Rendering | CPU/WebGL2 color, threshold, mask and alpha agreement; nonlinear LUT distinguishes scalar interpolation from interpolated colors; atlas gutters, tile seams, cut boundaries, partially supported pixels, DPR changes and context restoration |
| Picking/linking | CPU raycast proxy, GPU face pick, direct `pickSurfaceLocation`, viewer hover/click, flatmap hover/click, annotations and ROI selection all resolve the same original face/location under morph and relief; incompatible domains reject linking |
| Lifecycle/demo | Chapter switch during load/preparation; repeat mount/dispose; rapid source/depth changes; detached surfaces; selection surviving mode changes; export after pending work; desktop/narrow layouts, keyboard controls, missing/error states and public-API excerpts |

Numerical tolerances are chosen before examining real-data failures, based on float64 reference arithmetic, float32 presentation and coordinate scale. Record max/RMS error and support-mask agreement separately. Do not widen tolerance to admit a failed fixture. Preserve adverse cases and state whether they fail input admission or an implementation assertion.

Use pycortex's pinned raw folding-height calculation and selected flatmap samples as differential evidence where interpolation, depth quadrature, topology and missingness are deliberately matched. Differences in finished smoothing or interior sample locations are declared method differences, not parity failures or successes. Analytic fixtures remain the primary correctness oracle.

Proposed tests: `tests/unit/flatmap/*.test.ts`, `tests/unit/relief/*.test.ts`, `tests/e2e/quantitative-flatmap.spec.ts`, `tests/e2e/flatmap-relief.spec.ts`, plus extensions to existing flatmap, GPU picking, morphing, geometry and `chapter-anatomy.spec.ts` regressions. Dedicated browser fixtures live under `tests/`, with stable diagnostic APIs that expose results/resources rather than private implementation objects.

## 9. Performance qualification

Separate construction, first presentation, warm interaction, frame application, export, transfer and memory. Benchmark analytic 10k/32k/164k meshes and the admitted real specimen; record actual vertex/face counts, chart coverage, 512/1024/2048 image dimensions, 1/8/32 depth samples, masks, DPR, browser/GPU and source revision.

Hard invariants: no full-vertex scan on warm hover; no sampling rebuild for presentation changes; no volume clone per tile; memory stays within declared byte budgets; obsolete work cannot commit; repeated disposal releases all owned handles. Measure CPU arrays, build scratch, transfer copies, value cache, GPU textures and CPU/GPU pick proxies separately.

Initial interactive acceptance targets on a recorded reference desktop, to be confirmed by the first vertical slice: warm local lookup p95 ≤4 ms; LUT/threshold/exaggeration input-to-present p95 ≤50 ms; no new main-thread task over 50 ms during steady interaction; cancellation acknowledged within 100 ms under the bounded workload. These are targets, not current results or promises for every device. A missed target requires profiling, a documented correction or an explicit scope decision; do not silently weaken it.

For volume frame playback, report achievable complete-frame throughput and peak memory at each sample/resolution setting rather than promising 60 fps. Use the same values, masks, interpolation, depth count and output resolution when comparing direct sampling to prepared tiles. Include cold-cache cost and cases where preparation does not amortize. Compare against pycortex only when its input and sampling contract are actually matched, and record CPU/GPU execution differences.

Benchmark commands added during implementation should produce machine-readable receipts and raw logs in a dated `benchmarks/` directory. Ordinary CI checks deterministic operation/resource invariants; reference-machine performance thresholds belong in the browser benchmark job, not fragile wall-clock unit tests.

## 10. Delivery slices and exit gates

| Slice | Bounded work | Depends on | Exit evidence |
| --- | --- | --- | --- |
| M0 — dataset and contracts | Admit matched anatomy; freeze correspondence, sampling/coverage and relief conventions; capture current regressions | None | Provenance manifest, checksums, admitted geometry, small analytic fixtures and explicit invalid cases |
| M1 — chart and raster core | Cut-aware chart, spatial index, deterministic tiled raster, canonical location conversion | M0 contracts | Independent triangle/overlap/seam tests; chart-to-anatomy round trip; budget checks |
| M2 — quantitative vertical slice | Vertex-scalar sampling, typed controller, Canvas2D reference, WebGL2 LUT path, linked inspection | M1 | Real scalar map in existing flatmap chapter; CPU/GPU colors and missingness; legacy flatmap tests pass |
| M3 — depth sampling and cache | Volume stencils, coverage, footprint/depth readout, worker registration, tile eviction and frame updates | M1–M2 | Analytic volume oracle; worker cancellation/stale safety; no per-tile volume copies; cold/warm receipts |
| M4 — relief and distortion core | Folding height, declared smoothing, slopes, chart Jacobian diagnostics | M0–M1 | Formula/gradient/distortion tests; real admitted specimen; preprocessing budget receipt |
| M5 — shared 3D display and picking | Sampled-field 3D binding; relief mesh; centralized deformation adapter; CPU/GPU picking and annotation integration | M2–M4 | Nonlinear LUT parity; all named picking paths; stable anatomical quantities through morph/exaggeration |
| M6 — complete demo and export | Public API excerpts, coverage/depth/relief/distortion modes, responsive controls, full-resolution export and metadata | M3–M5 | Real matched anatomy demo, fixed visual specimens, keyboard/error/lifecycle tests and export verification |
| M7 — qualification and docs | Required checks, adversarial review, performance matrix, bundle/consumer checks and usage guide | M6 | Exact-revision evidence with remaining limits; no claims beyond tested datasets/backends |

M3 and M4 have separable implementation scopes after M1/M2 contracts settle. Keep one writer per module and a single integrator for public exports, worker protocol and picking hooks. Each slice is reviewable independently; do not defer correspondence or picking correctness until visual polish. Create work items in the existing Mote store when implementation starts, referencing this plan rather than creating a parallel tracker.

## 11. Verification commands and completion

For implementation, use the current repository commands:

```sh
npm test
npm run type-check
npm run test:types
npm run lint
npm run build
npm run test:package-consumers
npm run size
npm run type-check:demo
npm run demo:build
npm run docs:build
```

Before browser automation, select the Playwright task profile when using browser MCPs and run the ownership audit:

```sh
node ~/.local/share/agent-policy/browser-automation-guard.mjs --audit
npm run dev:ci
```

With that owned server running, targeted checks (new spec paths become available in their implementation slices):

```sh
npm run playwright:test -- tests/e2e/quantitative-flatmap.spec.ts tests/e2e/flatmap-relief.spec.ts tests/e2e/chapter-anatomy.spec.ts tests/e2e/surface-geometry.spec.ts
```

Run the broader `npm run test:playwright` gate before completion, reusing or closing the owned server appropriately. Use the installed Playwright browser, never automated system Chrome or another session's profile. Close owned browser/server resources and rerun the audit. Preserve actual exit status and full logs. Environment-blocked browser checks are not visual acceptance.

For this plan-only change, verify document links and the docs build; runtime tests cannot qualify unimplemented features. VitePress currently ignores dead links, so a passing build alone is insufficient to establish link validity.

Completion requires all selected functionality, the matched real dataset, meaningful numerical and browser evidence, the visual demo, public-API documentation and performance receipts. An implementation receipt must distinguish local tests, visual inspection, scientific scope and any hosted CI result. Keep planned API names and unmeasured targets out of claims about delivered features.

## 12. Principal risks and next action

| Risk | Required response |
| --- | --- |
| Real data is not legally redistributable or cannot establish correspondence | Hold anatomical acceptance; select a documented alternative; never relabel synthetic anatomy as real |
| Cut topology or UV overlap breaks identity | Reject at chart admission with face IDs and diagnostics; no silent retriangulation |
| Point sampling is mistaken for ribbon integration or laminar inference | Keep separate method names, provenance and readouts; test a counterexample |
| Legacy vertex-color interpolation differs from quantitative pixels | Use the explicit shared sampled-field binding; preserve existing rendering semantics |
| Shader relief diverges from picks, anchors or bounds | Fix the common deformation adapter and all entry paths before exposing relief in the demo |
| Prepared volume stencils or broad smoothing exceed memory/time targets | Use bounded direct/streamed computation; retain quality and declare latency; optimize only after profiling |
| Invalid anatomical areas create extreme relief | Mask/report invalid support; inspect input and policy; do not quietly clamp evidence away |
| Visual relief obscures map interpretation | Default to unlit quantitative display and an independently labeled relief/distortion presentation |

The original M0–M7 sequence has been implemented. See section 13 and `benchmarks/2026-10-28-flatmap/README.md` for evidence and qualification limits.

## References

- [Pycortex pixel sampling and cache](https://github.com/gallantlab/pycortex/blob/1e4c0790b66bcbcd836b5832650908f83327c399/cortex/quickflat/utils.py).
- [Pycortex folding-height and relief preparation](https://github.com/gallantlab/pycortex/blob/1e4c0790b66bcbcd836b5832650908f83327c399/cortex/polyutils/bumpy.py).
- [Pycortex relief GPU attributes](https://github.com/gallantlab/pycortex/blob/1e4c0790b66bcbcd836b5832650908f83327c399/cortex/webgl/resources/js/mriview_surface.js).
- [Existing surface geometry design](surface-geometry-plan.md) and [implementation receipt](surface-geometry-implementation.md).
- [Existing cortical evidence plan](cortical-evidence-plan.md): coordinate future canonical-selection changes; this file is separate ongoing work and is not modified here.

## 13. Delivery decisions and qualification boundary

M0–M7 are delivered locally. The dated benchmark directory contains the execution receipt, raw logs, numerical reference, performance matrix, source hashes and rendered specimens. The [usage guide](../guide/quantitative-flatmaps.md) and `examples/quantitative-flatmap.ts` describe the actual API. Local qualification does not imply hosted CI, publication, cross-browser acceptance or clinical validation.

- **Matched data:** pinned real S1 left white/pial/inflated anatomy has 152,893 vertices and 305,782 identical faces. Admission explicitly omits 288 inverted/overlapping flat faces, leaving 291,063, and splits one disconnected cut-vertex fan into two chart copies. No anatomical positions or IDs are repaired. The manifest preserves excluded source IDs, seam correspondence, coordinate assumptions, hashes and repository-license provenance. Functional scalar/volume values are constructed and labeled.
- **Optional package:** quantitative classes are exported from `surfview/flatmap`; core anatomy, workers, colormaps and `FlatMapView` remain in `surfview`. A root-export prototype exceeded the unchanged 180 kB core Brotli gate. The optional ESM bundle shares core class/registry identities, starts no worker on import, and has its own 20 kB gate. Packed consumers verify this seam.
- **Module consolidation:** inspection belongs to `FlatMapSampler` and `FlatMapController`; the shared deformation shader lives with `ReliefDisplayBinding`. `FlatMapViewAttachment` implements a small core interface. The controller owns canonical selection; the demo connects existing public picking and annotation APIs directly. No additional selection store or `LinkedBrainWorkspace` refactor was needed.
- **Raster and storage:** shared boundaries use the lowest chart-face ID, consistently in lookup and rasterization. The controller streams requested grids in tiles and retains byte-bounded plans and values. Presentation uses a bounded full-field texture; viewport-specific tile scheduling and a texture atlas are not implemented. Large scans rebuild evicted plans, explicitly measured in the matrix.
- **Ownership:** frame/geometry snapshots, grid descriptors, delivered cache arrays and export metadata are independent of later caller mutation. Worker geometry registration survives frame changes; cancelled renders cannot commit. Partial registrations roll back. Attachments cancel only their own preparation and borrow their controller/renderer. Exports create an independent controller snapshot.
- **Relief:** raw height uses complete anatomical areas, then maps to cut vertices. `log-gaussian-relief-v1` regularizes positive log heights with area-weighted Gaussian smoothing on the cut chart. This differs from pycortex's screened-Poisson smoothing. The pinned raw function is compared separately; finished-relief parity is not claimed. Exact per-face area/anisotropy diagnostics are public; the demo labels its continuous area colors as vertex averages.
- **Presentation and export:** CPU/WebGL2 and the folded/relief binding share scalar-before-LUT semantics. The demo includes depth/coverage inspection, persistent anatomical selection, ROI SVG/label-GIFTI and PNG/JSON exports. The quantitative PNG is unlit and excludes ROI artwork/relief; this distinction is explicit in its sidecar and guide.
- **Performance scope:** the reference browser uses SwiftShader, not a native GPU. Recorded CPU commit, GL submission, animation-callback and cancellation timings are scoped to their harness. The original complete paired-view input-to-present target remains unqualified; two animation callbacks are not a photon measurement. Full-frame throughput is reported at each resolution/depth combination, including cache-thrashing cases. Component byte budgets do not bound all browser/GPU memory.

The implemented public API, dataset admission and demonstrated workflow are complete for this scope. Native-GPU interactive qualification, other hemispheres/datasets, finished pycortex smoothing equivalence and viewport-driven texture residency are outside this acceptance claim.
