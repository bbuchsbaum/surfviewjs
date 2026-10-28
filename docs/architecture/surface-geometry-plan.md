# Surface geometry: implementation and improvement plan

Date: 2026-10-27. Status: all six capabilities implemented locally, with analytic, package and native-browser checks. External Workbench equivalence and the complete performance matrix remain unqualified. See the [implementation receipt](surface-geometry-implementation.md) for measured evidence and limitations.

Scope: the six directions approved in the Workbench review. This document preserves the implementation design, improvement strategy, delivery dependencies, and acceptance targets. It is not a claim that every proposed qualification gate has passed. The implementation receipt records the delivered behavior and differences from this design; the [usage guide](../guide/surface-geometry.md) describes the public APIs.

Source baseline: SurfViewJS `7b44e4491c52f7cea4f0eaae6472d906de041010`; Workbench `c114f466f91a1c89256530e7fc94b8b464fd43c7`. Preserve the unrelated `.claude/settings.json`, `docs/architecture/cortical-evidence-plan.md`, and `output/` work. Recheck HEAD, reservations, and relevant files before implementation.

## 1. Outcomes and delivery choices

| Approved direction | Delivered behavior | Main improvement | Efficiency mechanism |
| --- | --- | --- | --- |
| 1. Parcel boundaries | Connected, editable surface curves shared by adjacent parcels | Borders agree with parcel fills; explicit junctions, holes, and open ends | Build topology once; trace all interfaces in one pass; update only affected faces after edits |
| 2. Geodesics | Surface brush, ruler, ROI growth/erosion, and data-guided paths | Anatomical distances stay stable while display geometry changes; approximation is named | Local cutoff search, reusable heaps, visited-generation arrays, worker execution |
| 3. Surface anchors | Precise triangle attachments that follow morphs and variants | Subvertex picking, validated correspondence, shared attachment semantics | Evaluate only referenced vertices; batch annotation instances and border endpoint buffers |
| 4. Area-aware operations | Vertex/parcel areas, area summaries, physical-scale smoothing, area cluster filters | mm/mm² contracts, explicit estimands and missing-data coverage | Reusable geodesic neighborhoods and sparse weights; streaming frame application |
| 5. Surface resampling | Validated reusable scalar/label mapping plans, followed by registered-sphere plan construction | Separate categorical semantics, mapping validity, and anatomical registration | Compact sparse plans; accelerated closest-triangle search; frame batching |
| 6. Ribbon integration | Volume-weighted sampling of vertex columns between white and pial surfaces | A named column-volume model with explicit coverage, beyond segment sampling | Reusable voxel weights; conservative spatial rejection; exact clipping in boundary cells |

Implement the small common contracts first, then 3 and 1, then 2 and 4, then 5 and 6. Numbers retain the review's ordering, not the coding order. Each feature must reach its own numerical and integration gates; a completed helper is not a completed feature.

Keep Three.js, the current compositor, `DataLayer`, and existing public entry points. Add focused pure TypeScript modules under `src/geometry/`; no new runtime numerical dependency, WebGPU backend, general computation graph, or viewer rewrite. Built workers are optional artifacts loaded explicitly. Do not create a new package subpath unless package tests demonstrate an unavoidable packaging need.

Registration, cortical reconstruction, statistical inference, surface inflation generation, distortion visualization, laminar surfaces, and MRI slice contour rendering are outside these six deliverables. The latter three remain follow-on ideas, not hidden acceptance requirements.

## 2. Verified integration points

| Current owner | Verified behavior | Planned change |
| --- | --- | --- |
| [SurfaceGeometry](../../src/classes.ts) and [meshAdjacency](../../src/utils/meshAdjacency.ts) | Public mutable arrays; cached `Set[]` adjacency; geometry shape/range validation | Add an explicit immutable computation snapshot and compact topology; preserve legacy adjacency API |
| [SurfaceSet](../../src/SurfaceSet.ts), [MorphableSurface](../../src/MorphableSurface.ts), [VariantSurface](../../src/VariantSurface.ts) | Shared faces across variants; GPU morph deltas or CPU position updates | A common display-position evaluator and revision notification for attachments |
| [Parcel patch construction](../../src/puzzle/parcelPatches.ts) | Two-label midpoint cut; three-label midpoint-to-centroid partition | Extract the combinatorial partition into one pure helper consumed by fills and borders |
| [MultiLayerNeuroSurface](../../src/MultiLayerNeuroSurface.ts) and [OutlineLayer](../../src/OutlineLayer.ts) | Draw edges joining differently labelled vertices; own normal/wide line buffers and halos | Add true boundary curves and reuse line/material lifecycle |
| [Picking controller](../../src/viewer/ViewerPickingController.ts), [GPU picker](../../src/utils/GPUPicker.ts), [annotations](../../src/annotations.ts) | Vertex-oriented pick result and stored marker position | Add precise surface-location picking and anchor-aware annotations without removing vertex APIs |
| [ROI utilities](../../src/roi.ts), [inspection](../../src/Inspection.ts), [linked workspace](../../src/LinkedBrainWorkspace.ts) | Vertex membership, vertex/parcel selection, linked interaction | Store geodesic brush output as ordinary `VertexROI`; keep exact location as optional attachment data |
| [StatisticalMapLayer](../../src/layers/StatisticalMapLayer.ts), [statistics utilities](../../src/utils/statistics.ts) | BFS clusters filtered by vertex count | Add explicit area filtering and sign policy; retain existing vertex-count behavior |
| [DataLayer](../../src/layers.ts), [TemporalDataLayer](../../src/temporal/TemporalDataLayer.ts) | Scalar buffers and revisions; temporal playback writes its output buffer | Derived results use a separately owned layer/buffer; never write into playback-owned data |
| [Projection API](../../src/projectVolume.ts), [sampling core](../../src/volumeProjectionCore.ts) | Normal/white-to-pial segment sampling; zeros valid; invalid result NaN/count zero | Keep existing APIs and add a distinct column-integration plan API |
| [Portable scenes](../../src/scene/SceneManifest.ts), [binary assets](../../src/scene/BinaryAssets.ts) | v1/v2 scenes, SHA-256 assets, float32/uint32 codecs | Reuse hashing/codec concepts; separately version computation plans and anchor collections |
| [Performance harness](../../scripts/performance-benchmark.mjs) | Fixed mesh-size cases, repeated timing, machine-readable output | Add a separate geometry benchmark with the same reporting conventions |

The two scene exporters do not have interchangeable manifest shapes. Do not attach computation plans to an existing schema by silently adding fields. First deliver explicit `export/import` for plan and anchor artifacts; existing v1/v2 reports continue to contain final scalar maps. Automatic report replay of computations needs a separately specified schema extension and is not required here.

## 3. Common contracts: topology, geometry, ownership, and execution

### 3.1 Identities and frames

Introduce `SurfaceDomain`, `SurfaceMetric`, and `DisplayGeometryBinding` in `src/geometry/SurfaceDomain.ts` and `src/geometry/DisplayGeometryBinding.ts`.

- A domain owns vertex correspondence and faces. It includes an explicit domain ID, hemisphere/structure, vertex count, and topology fingerprint. Same-sized arrays do not establish correspondence.
- A metric owns an immutable position snapshot in a named coordinate frame, units (`mm` for physical operations), and a geometry fingerprint. Geodesic distance, area, and sampling use this snapshot, not `mesh.matrixWorld` or inflated display coordinates.
- A display binding resolves the same domain into current drawn positions. It tracks geometry replacement, variant updates, morph weights, and disposal separately from metric changes.
- Fingerprints use SHA-256 of a versioned descriptor plus canonical little-endian bytes. Topology includes ordered faces, vertex count, and correspondence/structure metadata; geometry additionally includes positions, frame, and units. Face-order changes conservatively invalidate stored artifacts. Reordered vertex identities require an explicit remapping, not a guessed match.
- Local synchronous computations use an opaque snapshot identity. Persistent fingerprints are computed asynchronously when registering/exporting the snapshot; hashing never occurs on pointer moves or each frame. The persistent hash is not a substitute for upstream anatomical provenance.
- Copy mutable caller arrays once at snapshot creation and keep owned arrays private. Public access returns copies or queries. Do not rely on TypeScript `readonly` to make typed-array elements immutable. Provide an explicit new-snapshot operation for edited geometry; a stale plan is rejected rather than quietly reused.

Coordinate transforms used to register volume and surface data must be explicit affine inputs with source/destination frame IDs. Rendering layout transforms do not change physical measurement. Compute areas/distances after any intended scientific affine, in mm; anisotropic transforms cannot be represented by a scalar unit conversion.

### 3.2 Compact topology and validation

`src/geometry/SurfaceTopology.ts` constructs vertex-neighbor CSR arrays, vertex-face incidence, undirected edges, oriented face-edge incidence, connected components, and boundary flags. CSR means a packed index array plus row offsets, avoiding one JavaScript object per neighbor.

Build with integer endpoint pairs and fixed-pass radix sorting of typed arrays; avoid string edge keys and unsafe integer packing. Deduplicate neighbors, preserve deterministic ordering, and account for scratch storage. Expected work is O(V + F) with fixed-width indices. Validate row-offset overflow and array-size limits before allocation.

Reject repeated vertex IDs within a face, duplicate faces, non-finite coordinates, and scale-relative zero-area triangles for the new numerical APIs. Report offending face IDs. Report non-manifold edges and inconsistent winding: boundary tracing and ribbon integration require oriented manifold input, while a distance-only graph may explicitly admit a non-manifold graph mode without claiming manifold-geodesic meaning. Open boundaries and disconnected components are supported; isolated vertices are reported and excluded from positive-area operations.

Use the existing renderer validation unchanged. A mesh that can be displayed is not automatically qualified for every computation. Keep legacy `getAdjacency()` behavior; adapters share the new topology where possible without forcing both representations to be allocated.

### 3.3 Plans and memory

Use small feature-specific plans, sharing internal CSR validation and iteration rather than a public all-purpose operator framework. Each plan records method/version, input identities, units, options, validity, exact owned byte counts, and construction diagnostics.

Default retained plan budget: 128 MiB; default total computation budget including build scratch: 256 MiB per executor. These are configurable safety limits, not claims about device capacity. Estimate required storage before large allocations and check during incremental construction. No silent truncation of neighborhoods, contributors, or accuracy when a limit is reached: use an explicit streamed/chunked construction mode or return `budget-exceeded` with the required bytes.

Use float64 arithmetic and distances/weights during construction and reduction; coordinates may originate as float32. Keep sparse weights float64 in the first implementation. Offer float32 plan storage only after measured accuracy and memory comparisons; its precision becomes part of the plan metadata. Returned display values may be float32 with overflow checks. For K nonzeros and N output rows, raw CSR storage with uint32 indices and float64 weights is `12K + 4(N+1)` bytes, before validity, hashes, and feature metadata.

### 3.4 Worker and lifecycle protocol

Implement `src/geometry/GeometryExecutor.ts`, `geometryWorker.ts`, and `workerProtocol.ts` with typed discriminated job/result messages. A request includes job ID, input snapshot IDs, parameter revision, and destination-layer revision. Commit a result only if all still match and the target surface/layer is alive.

- Supply synchronous pure functions for Node and small workloads. Provide an async executor with a caller-supplied `workerFactory`; publish an explicit built worker file and test URL resolution in ESM, UMD, and embed consumers. Do not spawn workers on import or require Blob URLs, cross-origin isolation, or `SharedArrayBuffer`.
- Register snapshots once per worker. Transfer only separately owned computation buffers; never detach a live renderer buffer. Frame application borrows synchronously or transfers an owned copy asynchronously.
- Use a single worker initially. Keep one running interactive job and the latest pending preview; final committed requests receive explicit completion or cancellation. Reuse plan handles for smoothing/resampling/integration.
- Break construction and searches into resumable chunks, with a target of at most 8 ms worker work between event-loop yields. Cancellation messages cannot interrupt one giant synchronous loop. Check cancellation between chunks and before output commit. Synchronous APIs only inspect an already-aborted signal before work; they do not promise mid-call cancellation.
- On surface removal, cancel jobs and release registered snapshots/plans. On executor disposal, reject pending promises, release buffers, and terminate only owned workers. An injected executor remains caller-owned unless the constructor explicitly takes ownership.
- Main-thread fallback uses the same resumable kernel with a smaller time budget. It must expose slower availability rather than freezing the UI or silently dropping accuracy.

### 3.5 API shapes and failure policy

The names below are proposed exports, not available APIs. `metric` and `domain` refer to validated owned handles, not arbitrary renderer objects. Builders return new owned plans; `apply` calls never mutate a plan or input. A provided output must have the exact shape and must not overlap input buffers. Without an output argument, allocate and return owned output buffers.

| API | Required inputs and defaults | Returned contract |
| --- | --- | --- |
| `buildSurfaceBoundaryGraph(domain, labels, options)` | Int32/Uint32 labels, explicit background, midpoint partition | Location table, endpoint index pairs, label pairs, parcel incidence, revision; `updateLabels(changes)` produces the next revision |
| `traceBoundaryCurves(graph, selection)` | Optional parcel/label-pair selection | Packed location IDs plus curve offsets, closed flags, and terminal reason codes |
| `createGeodesicIndex(metric, options)` | Method defaults to `triangle-pair`; optional explicit barriers | Handle with cutoff, multi-source, and path queries; compact vertex IDs/Float64 distances or requested dense result |
| `pickSurfaceLocation({x, y, opacityThreshold})` | Canvas client coordinates, current visibility policy | Null or `{ surfaceId, location, worldPoint, displayRevision }`; no inferred GPU face |
| `evaluateSurfaceLocation(location, binding)` | Verified matching domain, requested current embedding | Float64 xyz; normal offset belongs to the separate anchor evaluation |
| `computeVertexAreas(metric)` | Anatomical positions in mm | Float64 mm² per vertex, total area, isolated-vertex mask |
| `buildSurfaceSmoothingPlan(metric, options)` | Required FWHM, optional fixed ROI, support/barrier mode, 4-sigma default cutoff | Sparse fixed weights, nominal support and approximation metadata |
| `applySurfaceSmoothing(plan, values, validity, output?)` | Float32/Float64 values; optional Uint8 validity; nonfinite values always invalid | Float32 values, Uint8 validity, Float32 retained nominal-kernel-weight coverage |
| `applyScalarResampling(plan, values, options, output?)` | Float32/Float64 values; strict missingness default | Float32 values, Uint8 validity, Float32 supported nominal-mapping-weight coverage |
| `applyLabelResampling(plan, labels, options, output?)` | Int32/Uint32 labels and optional validity | Same label dtype as input plus validity/coverage; invalid placeholder 0 has no semantic meaning without validity |
| `buildRibbonIntegrationPlan(input, options)` | Paired metrics and volume-grid identity, explicit column-model version | Sparse raw overlap volumes in mm³, total/in-grid column volumes, validity/diagnostics |
| `applyRibbonIntegration(plan, values, validity, output?)` | Exact volume length, optional mask, minimum coverage | Values/validity, total/in-grid/valid mm³, geometric/valid coverage, status per column |

Construction errors use stable codes: `invalid-shape`, `invalid-domain`, `frame-mismatch`, `unsupported-topology`, `degenerate-geometry`, `invalid-weights`, `checksum-mismatch`, and `budget-exceeded`, with relevant IDs/indices. Async execution additionally distinguishes `cancelled`, `stale-input`, and `disposed`. Unsupported rows/columns are result validity, not malformed-input exceptions. Do not partially install a failed plan or partially overwrite the visible output layer.

## 4. Direction 1: connected parcel boundaries

### Contract and algorithm

Add `buildSurfaceBoundaryGraph(domain, labels, options)` and `traceBoundaryCurves(graph, selection)` in `src/geometry/SurfaceBoundaries.ts`. The graph stores surface locations, segments, unordered label pairs, and oriented parcel incidence. Return curves as location-index sequences with closed/open status and terminal reasons (`junction`, `mesh-boundary`, or closed loop). Background is an explicit label value, not necessarily zero; validate signed/unsigned integer label inputs before conversion.

Use exactly the current parcel-fill partition:

1. One label on a face: no inter-label segment.
2. Two labels: join the midpoints of the two transitioning edges inside the face.
3. Three labels: connect each transitioning-edge midpoint to the face centroid, producing one three-way junction.
4. Deduplicate midpoint locations by undirected edge ID; centroids belong to faces. Emit each interface once with both parcel incidences. Background interfaces are selectable and retain their identity.
5. Trace maximal curves of constant label pair through degree-two nodes. Stop at junctions and open mesh boundaries. Canonical ordering uses stable topology IDs; never weld by approximate XYZ equality.

Extract the existing partition decisions into `src/geometry/labelPartition.ts`; make `parcelPatches.ts` consume it. Preserve current fills byte-for-byte where feasible, and test geometric equivalence where buffer order changes. The screen-space `atlasContours.ts` remains a separate visibility-contour algorithm, not a duplicate mesh-boundary implementation.

In `OutlineLayer`, add `boundaryMode: 'midpoint' | 'transition-edges'`. Preserve `transition-edges` as the existing default in the current major version; the demo and new APIs opt into `midpoint`. Any default switch is an explicit major-release decision. Reuse `LineSegments2`, opacity, halo, ordering, clipping, visibility, resolution updates, and disposal. Selecting a parcel changes an index/range selection, not topology construction.

### Improvements and efficiency

Initial graph construction is O(F + E); tracing is O(B), where B is the number of boundary segments. Store endpoints as anchors, so a morph only reevaluates B positions instead of rebuilding the graph. Style changes update uniforms/materials; camera/DPR changes update line resolution only.

Maintain vertex-to-face incidence for label edits. The graph owns its copied label snapshot; edits go through an explicit changed-vertex API that increments its revision. Recompute changed faces plus their affected edge/junction incidences. Trace the connected affected boundary components; do not promise O(changed vertices), because an edit may split a long loop. Full rebuild remains the deterministic fallback. Cache keys include topology identity, label revision, background policy, and partition version.

Editable borders snap control points to the surface and use Direction 2 for connecting paths. A boundary extracted from labels is read-only until explicitly converted to a user curve; moving a curve does not silently relabel the mesh. First export a lossless anchor polyline. SVG export projects to the requested view and reuses the existing visibility machinery; do not claim hidden-line removal from plain 3D-to-2D projection.

### Acceptance

- Hand-specified one/two/three-label triangle partitions, including background and negative label IDs; every segment separates the expected labels.
- Shared interfaces are identical in opposite parcel traversals; no duplicate segment, crack, or doubled triple junction. Open disks, holes, islands, disconnected components, face permutation, and rejected non-manifold cases.
- Incremental edits equal a fresh full rebuild after canonicalization. Parcel fill boundaries and extracted curves coincide at independent interior/edge sample points.
- Browser: midpoint borders on real atlas meshes; wide lines and halos at multiple DPRs; clipping, opacity, camera changes, morphing, and disposal. Existing transition-edge rendering remains covered.
- Extend `demo/chapters/layers.ts` and the existing parcel map lab/puzzle only where they already expose the same partition. No new gallery chapter.

## 5. Direction 2: geodesic interaction and morphology

### Contract and algorithm

Add `createGeodesicIndex(metric, options)` in `src/geometry/GeodesicIndex.ts`, with `withinRadius(seeds, radiusMm)`, `distanceToRegion(seeds)`, and `shortestPath(start, end)` methods. Results include `method`, reachable/visited information, distance units, and paths as surface locations. Use Infinity for unreachable distances and a separate visited mask for cutoff queries; do not confuse outside the cutoff with a disconnected component.

Offer two named modes:

- `edge`: exact shortest paths on the mesh-edge graph; an approximation to the continuous surface.
- `triangle-pair`: augment the graph with valid straight crossings of two triangles unfolded around their shared edge, then solve the augmented graph exactly. This is still an approximate surface geodesic.

For each interior manifold edge, unfold the two opposite vertices into a common 2D plane. Add the opposite-vertex shortcut only when its segment crosses the shared edge strictly within that edge and both triangles are nondegenerate. Store crossing weights and both segment lengths, so path reconstruction lies on the surface instead of drawing a chord through the cortex. Compute each undirected weight once and reuse it symmetrically.

Use binary-heap Dijkstra for radius/multi-source queries and A* for point-to-point queries. Euclidean straight-line distance is an admissible heuristic for uncorrected physical lengths. If a cost model could violate that lower bound, use Dijkstra rather than an unjustified heuristic. No group-average area correction is included in the first API; require actual metric coordinates.

ROI dilation selects vertices within radius of the seed set. Erosion retains ROI vertices whose distance from the complement exceeds the radius; mesh-boundary treatment is explicit (`outside-is-background` adds open-boundary vertices as exterior-distance seeds; `ignore-open-boundary` does not). These are vertex-domain morphological operations, not continuous erosion of Direction 1's midpoint polygons. Radius zero is an explicit identity for both operations. In barrier mode, paths cannot cross excluded vertices/faces, and triangle shortcuts require both traversed faces to be allowed. Output-only masks do not act as barriers. Empty seeds produce an empty dilation; a full closed component has infinite complement distance; ties at a positive erosion radius are removed.

Subvertex ruler endpoints connect to the three vertices of their containing triangles by valid in-face segments; endpoints in the same triangle also get the direct segment. Anchor-domain validation is mandatory. The brush initially uses nearest-vertex seeds for predictable legacy behavior, with an explicit precise-anchor option later in the same interaction slice.

Data-guided paths use nonnegative edge cost `length * (1 + strength * penalty)`, where the caller supplies a finite normalized penalty in [0,1]. Report physical path length separately from optimization cost. Missing penalties are barriers; do not call the result the shortest physical path. Curvature-to-penalty conversion specifies sign and normalization explicitly.

### Improvements and efficiency

Keep topology, lengths, and shortcuts separate, so labels and scalar maps cannot invalidate geometry work. Reuse heap storage and scratch arrays. A generation counter marks touched vertices, removing O(V) initialization from small-radius queries; handle counter wrap with one explicit clear. Return compact reached-vertex arrays for brushes; allocate dense distances only when requested.

Expected query work is O((V_r + E_r) log V_r) for the visited region, with O(V + E) retained index storage; never materialize all-pairs distances. Incremental pointer movement schedules the latest query through the executor. A local radius increase may continue an unfinished Dijkstra frontier for the same seed/metric/barrier revision; decreasing radius filters existing settled distances. Changing seed restarts search.

### Acceptance

- Exact small-graph distances from independent Floyd–Warshall; path segment lengths sum to returned length.
- Planar two-triangle fixtures where unfolding gives the analytic straight-line answer and edge paths overestimate it. Folded-pair fixtures preserve intrinsic distances under hinge rotation.
- `Euclidean distance <= triangle-pair distance <= edge distance` on valid uncorrected fixtures, within scale-aware roundoff. No claim that triangle-pair distance equals the exact continuous solution on arbitrary meshes.
- Multi-source output equals the minimum of independently run single-source results; rigid transforms preserve lengths; uniform scaling scales lengths and cutoffs; permutation preserves geometry after ID remapping.
- Analytic sphere refinement measures convergence against great-circle distance with mesh-discretization error reported separately; no invented fixed accuracy percentage for all cortical meshes.
- Workbench `-surface-geodesic-distance` and `-limit` fixtures are an external comparison, with exact binary/version/options recorded. Characterize discrepancies; do not label the API Workbench-compatible before a fixed comparison gate passes.
- Extend `demo/chapters/inspect.ts`: ruler, brush, grow/shrink, undo/redo of ordinary ROI membership, and measurements unchanged during inflation. Browser checks cover fast pointer changes, cancellation, hidden hemispheres, and stale-result rejection.

## 6. Direction 3: precise surface anchors

### Contract and algorithm

Add `SurfaceLocation` in `src/geometry/SurfaceLocation.ts`: either a vertex, or three triangle vertex IDs and barycentric weights, together with domain identity. `SurfaceAnchor` adds an explicit normal-offset value and offset frame. A location denotes a point on the triangulated surface; an anchor may be offset for display. Validate finite nonnegative weights and sum one within a stated roundoff tolerance; normalize only roundoff-sized residuals, never arbitrary malformed inputs.

`evaluateSurfaceLocation(location, binding)` reads the current embedding, including GPU morph target deltas and weights. Compute `p = sum(w_i * p_i)`. Derive the offset direction from the evaluated triangle geometry for a face-normal mode, or normalized interpolated display normals for a smooth-normal mode. A zero/cancelling normal yields an explicit failure; do not silently choose an arbitrary axis. Apply `matrixWorld` only when world display coordinates are requested. Physical offsets in mm require the metric binding; display offsets are explicitly in display units.

Add `pickSurfaceLocation()` alongside existing vertex picking. Initial precise picks use the current Three.js CPU intersection, retain the face, transform the hit into mesh-local coordinates, and compute barycentrics against the evaluated morph triangle. The GPU vertex ID is not sufficient to infer the hit triangle: do not manufacture an anchor from it. GPU picking remains a hover/vertex path until an independently tested face-ID/depth refinement exists.

Add `AnnotationManager.addAnchor()` and `moveAnchor()` while retaining `add(surfaceId, vertexIndex)` and `move()`. Vertex annotations adapt to vertex locations. Keep the existing vertex/parcel inspection selection union; precise attachments are an additive result/event field, not a new selection mode that breaks consumers. `LinkedBrainWorkspace` transfers an anchor only across the same verified domain or an explicit mapping.

### Improvements and efficiency

Implement one display evaluator used by annotations, boundary endpoints, and ruler paths. Maintain the list of referenced vertices and deduplicate evaluations across anchors. CPU work is O(U*T + A), where U is the number of distinct referenced vertices, T the active morph-target count, and A the anchor count, rather than evaluating all surface vertices.

Group marker instances by owning surface and compatible marker geometry/material, so anchors from two hemispheres never share an incorrect parent transform. Update only dirty instance ranges and endpoint buffer ranges once per render frame. Camera movement alone does not update local anchor coordinates. At high anchor counts, measure this CPU path before proposing GPU anchor evaluation; no shader path enters the first implementation merely because it might be faster.

Export/import a separately versioned anchor collection with topology identity, triangle IDs, weights, offset policy, and metadata. Reject mismatched domains; provide an explicit remap hook for Direction 5 rather than nearest-vertex guessing. Disposal removes event subscriptions and owned instances, including replacement of a surface under the same ID.

### Acceptance

- Analytic triangle points at vertices, edges, and interior; affine covariance for unoffset positions; degenerate rejection; serialization round trip with exact IDs and bounded weight error.
- Two surfaces with identical vertex count but different topology/domain must reject transfer. Remapped vertex permutations retain location only with the supplied mapping.
- Native browser tests for CPU precise picking during GPU morphs, interrupted morphs, CPU variants, transformed surfaces, clipping/visibility policy, and two hemispheres with different transforms.
- Marker and boundary positions agree with independently evaluated drawn triangles at each sampled frame. Measure instancing below/above the current threshold; check repeated add/remove/dispose releases resources.
- Extend the existing anatomy and inspect chapters, and `annotation-instancing.test.ts`, `morphable-surface.test.ts`, and `viewer-picking-controller.test.ts`.

## 7. Direction 4: area, summaries, smoothing, and clusters

### Area estimands

`computeVertexAreas(metric)` assigns one third of each triangle's area to each incident vertex, using float64 cross products and accumulation. This is lumped barycentric area, in mm². It sums to total triangle area. It is not mixed Voronoi area and does not silently substitute an inflated embedding.

Two distinct parcel/ROI area semantics must be named:

- `vertex-membership`: sum lumped areas of selected vertices. Use for Workbench-style vertex cluster area, geodesic brush membership, and ordinary vertex ROIs.
- `label-partition`: sum the actual clipped face pieces from Direction 1. Use when reporting the area enclosed by the displayed categorical borders. In a two-label triangle the singleton corner receives one quarter of the face, so this generally differs from lumped vertex-membership area.

`summarizeSurfaceRegion()` returns total area, valid area, coverage, weighted mean, and optional integral. For vertex-membership summaries use `sum(A_i*m_i*x_i)/sum(A_i*m_i)`. For label-partition summaries integrate a piecewise-linear scalar field over clipped subtriangles using their areas and vertex/interpolated values; name this different estimand. A subtriangle contributes only when every original vertex with a nonzero interpolation coefficient is valid; do not renormalize missing vertex coefficients and thereby change the field. Zeros are valid; mask/non-finite values are missing. Coverage is valid area divided by total area. Output NaN when valid area is zero. Never treat an area-weighted spatial summary as a participant-level statistical test.

### Physical-scale smoothing

Add `buildSurfaceSmoothingPlan(metric, { fwhmMm, roi, maskMode, kernelCutoffSigma })` and `applySurfaceSmoothing(plan, values, validity, output?)` in `src/geometry/SurfaceSmoothing.ts`.

Define the first public method as `area-gaussian`: `sigma = FWHM / sqrt(8*ln(2))`, `K_ij = exp(-d_ij²/(2*sigma²))` within the cutoff, and `W_ij = K_ij*A_j / sum_k(K_ik*A_k)`. Use Direction 2's named distance approximation. Default support is 4 sigma, with explicit override and provenance. Zero FWHM is an identity plan. Include the center; do not secretly expand a small kernel to one ring.

This definition preserves constants on valid rows and reduces sampling-density bias. It does **not** promise exact area-integral conservation or exact achieved Gaussian FWHM on an irregular curved mesh. Workbench's `GEO_GAUSS_AREA` performs a different scatter/gather normalization and uses different default support; do not market the simple formula as a bitwise port. Compare both at matched support to quantify quality. A conservation-preserving diffusion solver would be a separate future method with its own operator and scale calibration, not a hidden replacement.

Fixed ROI: exclude sources outside ROI, return invalid outside destination ROI. `maskMode: 'support'` restricts contributors; `barrier` additionally restricts geodesic paths. Dynamic frame missingness renormalizes only over valid contributors and reports retained nominal weight as coverage. A caller-set `minCoverage` in [0,1] can invalidate low-support output; denominator/coverage are recomputed when validity changes.

### Clusters and efficiency

Add a separate `applyClusterAreaThreshold(threshold, { minAreaMm2, metric, signMode })` to `StatisticalMapLayer`; leave `applyClusterThreshold(...minClusterSize)` unchanged. Default new sign mode is `separate`, so adjacent positive and negative activations are not fused by absolute-value thresholding. Return descriptive cluster membership, vertex count, mm² area, peak, and sign. The operation does not supply a cluster p-value or familywise correction.

Areas and components are O(F + V) once. BFS cluster filtering is O(V + E). Build smoothing neighborhoods once and apply in O(K) per frame; preallocate output and coverage buffers. If all frames share validity, cache normalized denominators. If memory exceeds budget, process row tiles through the same constructor with explicit recomputation cost rather than retaining an unbounded full-surface kernel. Batch a bounded number of frames per tile to reuse weights without retaining an entire time series. Separate output ownership from `TemporalDataLayer` playback.

### Acceptance

- Analytic triangle, square, tetrahedron, and refined sphere areas; total-area sum, scale-squared behavior, translation/rotation invariance. Constant and linear scalar integration on clipped triangles has an analytic oracle.
- Explicit fixture demonstrating vertex-membership and label-partition area differ correctly. Results never change with visual inflation, camera zoom, or layout.
- Smoothing: constant preservation, nonnegative normalized weights, masked/zero/NaN distinction, empty support, impulse footprint, fixed versus changing masks, and identical synchronous/worker results.
- Nonuniformly tessellated planar fixtures expose vertex-density bias; compare area-weighted output to independent continuous/numerically integrated Gaussian references. Record achieved width and area-integral drift rather than asserting nonexistent conservation.
- Area-filtered clusters are stable under known mesh subdivision within declared discretization tolerance; opposite-sign touching clusters remain separate in the new mode. Workbench area fixtures use the same lumped-area and sign conventions.
- Extend statistics and time-series chapters with explicitly descriptive labels; tests include layer ownership and stale playback results.

## 8. Direction 5: reusable surface resampling

### Phase 5a: application and interchange

Add `SurfaceResamplingPlan` and `applyScalarResampling()` / `applyLabelResampling()` in `src/geometry/SurfaceResampling.ts`. Plan rows are destination vertices; entries index source vertices. A `surfview.resampling-plan.v1` descriptor binds source/target domain and registered-sphere geometry fingerprints, method/version, source-area/target-area identities when used, correspondence provenance, masks, coverage policy, and CSR assets.

Import/export uses versioned float64 weights and uint32 index/offset codecs with little-endian encoding and checksums. Do not mislabel float64 bytes as the current scene format's float32 assets. Validate dimensions, monotonic offsets, index bounds, finite nonnegative weights, duplicate contributors (coalesce deterministically), nonempty row sums, final offsets, checksums, and memory limits. Empty rows remain explicitly unsupported. Reject malformed input before publishing a plan handle.

Scalar application is a weighted sum, with explicit `missing: 'strict' | 'renormalize'` (default strict), coverage, and `minCoverage`. Strict invalidates if any positive-weight contributor is invalid. Renormalize measures retained nominal weight; zero remains data. Before construction-time ROI filtering, retain each row's full nominal weight sum; store the fraction surviving ROI as `supportCoverage`. Runtime coverage is this fraction times the valid fraction of the final normalized row. This preserves excluded support information that row renormalization alone would erase. Categorical application aggregates weight by label and selects the largest total; deterministic ties use the lowest numeric label ID. Label zero may be valid; background/unassigned values and missingness are separate metadata. Never interpolate label IDs numerically.

Batch/stream application accepts caller-owned outputs and bounded frame blocks. Output and input aliasing is rejected unless a verified temporary-buffer mode is requested. A mapped display layer owns its output. Applying a plan is not registration, inversion, or recovery of information lost during downsampling.

### Phase 5b: constructing plans

Add `SurfaceTriangleIndex.ts` with a deterministic typed-array AABB tree and exact closest-point-on-triangle kernel, including edge/vertex Voronoi regions. Construct a bounded leaf tree using longest-axis median partitioning with deterministic tie rules; record tree build cost separately. Queries use best-first bounds and compare squared Euclidean projection distance, not sums of absolute barycentric weights. Handle degenerate faces according to the prevalidated-domain policy. Exhaustive search is the independent tiny-mesh reference.

Require registered source and target spheres with declared correspondence frame, common center/radius convention, hemisphere, and geometry identities. Validate near-spherical geometry against a recorded tolerance; normalize a private copy to a common radius only when explicitly requested. Do not infer registration from spherical shape. Use closest-triangle projection on the registered sphere mesh as the named `barycentric-closest` method. Radial ray projection is a different method and is not mixed into it opportunistically.

For `adaptive-barycentric-area`, follow the reviewed numerical design: construct forward gather and reverse scatter supports; for a target row use reverse support when it contains source vertices absent from forward support; multiply by target areas; normalize scattering contributions with source areas; apply source ROI after area correction; normalize final valid rows. Areas must be positive finite anatomical vertex areas bound to the respective domains, not sphere areas. Retain support and validity diagnostics. Do not claim exact global integral conservation after row normalization or ROI restriction.

Implement our own types, indexing, and validation. The MIT-licensed Workbench `.cxx` may inform an attributed adaptation only after a file-level dependency audit; GPL headers/helpers do not enter the implementation. Build a benchmarkable reference constructor first, then introduce the tree and compact storage with identical numerical selection rules.

### Improvements, efficiency, and acceptance

Separate O(build) from O(K*T) application. Barycentric plans have at most three nonzero weights per destination before coalescing; adaptive plans can have larger support and must report actual K. Reuse the source tree across target meshes and the plan across maps. All acceleration must preserve the same closest-point candidate and tie policy as exhaustive search. Typical tree queries are sublinear; worst-case linear behavior remains possible and is measured.

- Identity/permutation maps, analytic nonconstant planar fields, nearest edge/vertex cases, opposite sphere face, equal-distance ties, masks, empty rows, sparse label keys, and NaN/zero cases.
- Indexed versus exhaustive closest-point selection on random and adversarial small meshes. A constant field or round trip alone is insufficient evidence.
- Same versus mixed density spheres; upsampling and downsampling; geometry/area/hemisphere mismatch rejection; invalid/imported plan rejection before allocation limits are exceeded.
- External Workbench fixtures for `BARYCENTRIC` and `ADAP_BARY_AREA`, including full nonconstant maps and masked labels. On finite fixtures scaled to [-1,1], the initial compatibility gate is maximum absolute error at most `5e-5`, RMS at most `1e-5`, and identical supported-row masks; categorical predictions must agree except explicitly reported exact-weight ties. Record max/RMS errors, worst vertex IDs, coverage differences, and categorical agreement. A constructor missing this gate may remain available under its own accurately named method, but must not claim Workbench compatibility. Keep the gate fixed through optimization and retain failures. Historical parity failures in another surface port are a reason to test near-edge cases, not evidence that this implementation passes or fails.
- Existing data-in/out chapter demonstrates import/apply/save/load. Add registered-sphere construction there only after its own gate passes. Publishing plan application does not automatically qualify the adaptive constructor.

## 9. Direction 6: volume integration over ribbon columns

### Estimand and API

Keep `projectRibbonVolume()` unchanged: it samples white-to-pial line segments and returns valid sample counts. Add `buildRibbonIntegrationPlan({ domain, whiteMetric, pialMetric, volumeGrid }, options)` and `applyRibbonIntegration(plan, volumeValues, validity, output?)` in `src/geometry/RibbonIntegration.ts`.

The new method computes the volume-weighted mean of a **piecewise-constant voxel field** over a defined thin cortical column. It is not trilinear segment sampling. `volumeGrid` binds dimensions, voxel-to-world affine, axis order, units, and frame. White/pial positions require the same vertex correspondence and anatomical frame. Volume values are absent during plan construction.

Results include value, total column volume, volume inside the grid, valid sampled volume, geometric coverage (`inGridVolume / totalVolume`), valid coverage (`validVolume / totalVolume`), and status. Zeros are valid; an all-invalid column returns NaN and zero valid coverage. Default `minCoverage` is 1 with a documented numerical tolerance; hosts may explicitly lower it for exploratory partial columns. Apply this threshold to valid coverage, so out-of-grid volume cannot disappear through a denominator change. Normalize accepted means by valid sampled volume and retain coverage so this choice is visible. Do not reuse `validSamples` for a volume fraction.

### Column geometry and integration

Use a barycentric dual column independent of parcel labels: within every face, each vertex owns the quadrilateral from that vertex through its two edge midpoints and the face centroid. Split each quadrilateral into two triangles; use corresponding points on white and pial surfaces. This forms six triangular prisms per source face, allocated to the three vertex columns.

Triangulate each prism into three tetrahedra with a globally consistent vertex-order rule, so adjacent prisms choose the same diagonals on shared quadrilateral faces. Validate signed volumes, paired topology, winding, and local overlaps; reject collapsed/inverted or locally self-overlapping columns instead of taking absolute volumes to hide defects. Define this piecewise-linear tetrahedral ribbon as the model, rather than claiming a unique interpolation of warped prism faces. Global anatomical self-intersections remain a separate input-quality limitation; locally valid columns are not proof of globally disjoint cortex.

Transform tetrahedra into voxel coordinates once. Integer voxel indices denote centers, with cells `[i-0.5, i+0.5]` on each axis. Enumerate only cells overlapping each tetrahedron's AABB. Use conservative tetrahedron/AABB rejection; if a cell fully contains a tetrahedron, accumulate its whole volume. Otherwise clip the convex tetrahedron against the six cell halfspaces and compute the intersection volume with robust orientation and float64 arithmetic. Multiply by the absolute affine determinant to recover mm³. Coalesce repeated voxel contributions within a column into sorted sparse weights.

This improves on fixed subvoxel counting by avoiding missed thin slivers and a voxel-subdivision tuning parameter. It is geometrically exact for the chosen tetrahedral model up to floating-point error, not anatomically exact and not bitwise Workbench ribbon equivalence. Model differences and clipping error must be reported separately. Fixed-subdivision sampling is an independent comparison implementation, not a silent lower-quality fallback.

### Efficiency and failure handling

Reuse topology and barycentric submesh definitions for all white/pial pairs with that domain. Compute each shared geometric point once. Batch tetrahedra by source face and accumulate into bounded row-local numeric buffers; use pooled fixed-size clipping buffers rather than constructing geometry objects for every cell. Final application is O(K) per frame and does not revisit geometry. Changing only values or validity preserves the plan; changing positions, affine, dimensions, model, or numerical policy invalidates it.

Do not traverse the whole volume per vertex. Set per-column and total candidate-cell budgets and detect large bounding boxes caused by malformed coordinates. Support deterministic row chunks for large plans and cache only within executor byte limits. Streaming construction/application must yield the same rows as retained construction. An exact method that exceeds the interactive build budget remains a background/offline build; do not reduce precision without an explicit alternative method.

### Acceptance

- Closed-form axis-aligned columns through constant/piecewise-constant grids: exact overlap fractions, known means, affine scaling, shear/rotation transforms, negative determinant, and voxels touching only at a face/edge/point.
- Independent tetrahedron volume and small convex-intersection oracle; high-resolution subvoxel convergence for oblique columns. Do not require monotonic sampling error unless the comparator guarantees it.
- Positive local tetrahedra tile an analytic slab: sum column volumes equals slab volume and shared interior faces neither overlap nor leave gaps. Twisted/collapsed fixtures are rejected with vertex/face diagnostics.
- Plan weights sum to measured in-grid column volume; geometric and validity coverage differ correctly for out-of-volume versus masked data. Test very thin slivers, NaN, valid zero, zero support, and strict/relaxed coverage.
- Workbench `-volume-to-surface-mapping -ribbon-constrained -thin-columns` comparisons record voxel subdivision and expected geometric-model differences. Segment and column estimands have a deliberate counterexample proving the APIs are not aliases.
- Extend `demo/chapters/volume.ts`: explicit segment/column method choice, coverage visualization, reproducible synthetic volume, and separate displayed coverage/readout. Keep existing GPU normal-projection behavior intact.

## 10. Efficiency qualification and stop rules

Create `scripts/benchmark-surface-geometry.mjs` and `benchmarks/surface-geometry-baseline.json` during implementation. Use the existing Node benchmark's timing/reporting conventions and browser test harness. Record source SHA, fixture SHA/license, runtime/browser/Three.js versions, hardware, method/options, completed rows/vertices, dtype, warmup, sample count, p50/p95, variability, retained bytes, peak build memory, and cancellation latency.

| Workload | Fixed cases | Proposed acceptance target, not measured evidence |
| --- | --- | --- |
| Topology/snapshot construction | 32,492; 163,842; 324,002 vertices, bilateral where supported | Linear storage; no per-frame rebuild; budgets include transient sorting arrays |
| Boundaries | 400/1,000 parcels; full build; 1/100/1,000 edited vertices | Style/camera changes build zero topology; incremental result equals full rebuild; record affected-component size |
| Anchors and curves | 100/1,000/10,000 anchors; 1/2/4 active morph targets | At 1,000 anchors, p95 update under 4 ms on the pinned reference machine; no O(V) frame scan |
| Brush queries | 5/10/20 mm radii, 100 fixed seeds on anatomical 32k/164k meshes | Warm 10 mm query p95 under 16 ms at 32k and 50 ms at 164k; no main-thread task over 16 ms from the async path |
| Smoothing | FWHM 2/4/8 mm, 1/100 frames, fixed/changing validity | Separate construction, transfer, apply, and GPU upload; warm 32k map apply p95 under 16 ms where K fits budget |
| Resampling | Identity, 32k→164k, 164k→32k, scalar/labels, 1/100 frames | Cached apply at least 2× faster than rebuilding+applying for repeated maps; tree matches exhaustive choices |
| Ribbon integration | 1/2/3 mm grids; 32k/164k columns; 1/100 frames | No whole-volume scan per vertex; report candidate cells and K; cached 32k apply p95 under 33 ms on reference fixture |
| Lifecycle | Repeated register/build/cancel/dispose; stale layer/frame jobs | No unbounded retained-byte growth; cancellation observed within 50 ms p95; zero stale result commits |

Reference hardware and fixtures are pinned in the first baseline ticket before optimization. Targets are usability goals; if a correct implementation misses them, report the miss and choose a measured optimization or explicitly background-only UI. Do not lower numerical quality or rewrite targets after seeing results without recording the decision.

Compare each optimized kernel against a simple correct implementation on the same inputs. Distinguish algorithmic improvements from worker responsiveness and transfer overhead. Cold parse/hash/build, first application, warm application, render upload, and peak memory are separate measurements. Performance CI uses a stable runner and variance-aware regression bounds; ordinary unit CI checks complexity counters and allocations, not fragile wall-clock assertions.

## 11. Independent evidence and repository checks

Add tests under `tests/unit/geometry/` and small synthetic/oracle fixtures under `tests/data/surface-geometry/`. Proposed focused files: `surface-topology.test.ts`, `surface-boundaries.test.ts`, `geodesic-index.test.ts`, `surface-location.test.ts`, `surface-areas.test.ts`, `surface-smoothing.test.ts`, `surface-resampling.test.ts`, `ribbon-integration.test.ts`, and `geometry-executor.test.ts`.

Numerical tolerances are tied to coordinate scale, dtype, and conditioning. For ordinary nondegenerate unit-scale float64 analytic fixtures, start with absolute+relative tolerance of `1e-10 + 1e-10*abs(expected)`; adjust only with a documented error analysis, not to fit an observed failure. Float32 display conversion gets a separate quantization tolerance. Approximation/discretization error has separate bounds and reports; do not hide it inside roundoff tolerance.

External oracle receipts include Workbench version/binary hash, command argv, input hashes and licenses, output hashes, platform, and comparison script revision. Ordinary CI consumes small committed outputs; regeneration is an explicit script requiring `wb_command`, not a network dependency of tests. Read the license of every reused source/fixture and preserve attribution. No restricted participant data is required.

Verified existing commands for each affected slice:

```sh
npm test
npm run type-check
npm run test:types
npm run build
npm run test:package-consumers
npm run size
```

For demo or browser changes, also run `npm run type-check:demo`, `npm run demo:build`, and `npm run test:playwright`. The last command is the verified existing full-suite wrapper; a focused run may use the installed Playwright CLI against an owned test server, but must not assume this wrapper forwards arbitrary spec arguments. Browser automation uses the project Playwright browser, one backend, and the required browser-automation-guard audits before/after; close only owned processes.

For this planning document, verify local links explicitly and run `npm run docs:build`. VitePress currently has `ignoreDeadLinks: true`, so a successful docs build is insufficient link evidence. No algorithm test or benchmark is claimed by validating a plan.

Retain current package size limits. If pure geometry exports make UMD/embed exceed limits, isolate optional heavy builders in an explicitly designed entry point and update consumers/docs with justification; do not simply raise limits. Every public API has a type-contract fixture, a supported package-consumer example, disposal/ownership documentation, and additive compatibility tests.

## 12. Delivery sequence and Mote acceptance

Mote epic: `bd-01M5ZBQWQDNT1QRNQ9YN75V2AH`. Planning task: `bd-01M5ZBRDRXCHN2EK00DBSKE95B`. The tracker owns execution status; this document owns the design.

| Slice | Depends on | Owned implementation scope | Completion evidence |
| --- | --- | --- | --- |
| G0 — shared domain/topology/executor | Planning | `SurfaceDomain`, `SurfaceTopology`, `GeometryExecutor`, worker protocol/build artifact, baseline harness | Invalid domains rejected; budgets/cancellation/disposal proven; package consumers work; baseline captured |
| G3 — anchors and precise picking | G0 | Surface location/display binding, annotations, picking, morph/variant notifications | Analytic anchors plus native morph/pick/hemisphere fixtures; legacy vertex APIs pass |
| G1 — shared boundaries | G0, G3 | Label partition, boundary graph, outline integration, parcel-patch adapter | Partition equivalence, junction/open-boundary fixtures, incremental/full equivalence, visual proof |
| G2 — geodesic interactions | G0, G3 | Graph/index, unfolded crossings, morphology, ruler/brush, ROI adapter | Independent distance/path witnesses; Workbench comparison; responsiveness and stale-query checks |
| G4 — area operations | G0, G1, G2 | Areas/summaries/smoothing, cluster-area layer API | Named estimands, conservation limitations, density-bias oracle, cluster sign/area tests |
| G5a — plan application | G0 | Resampling CSR contract, codecs, scalar/label application, interchange | Corruption/mismatch/missingness gates; batch/stream equivalence; package demo |
| G5b — registered-sphere construction | G5a, G4 | Triangle index, barycentric/adaptive constructors, oracle generator | Exhaustive/indexed equality and separately reported Workbench parity; no registration overclaim |
| G6 — ribbon integration | G0, G4 | Column tetrahedralization, clipping, sparse plan, volume UI | Analytic overlap/volume proofs, independent oracle, coverage semantics, cached-frame benchmark |
| GQ — combined qualification | G1, G2, G3, G4, G5a, G5b, G6 | Cross-feature fixtures, measured report, public examples and compatibility | Shared-domain lifecycle, native browser evidence, exact source-bound numerical/performance receipts |

Issue IDs: G0 `bd-01M5ZC7SSDWZ9VSZDJH37PZ2MT`; G3 `bd-01M5ZC7TAHZPBXH54PNM95XRP7`; G1 `bd-01M5ZC7TWKWE9G10CQ2XE6GMXX`; G2 `bd-01M5ZC7VKWW839PC00ZF2XHKTH`; G4 `bd-01M5ZC7WAQ9S5BKGE62TN1VK94`; G5a `bd-01M5ZC7X6ZXHW72XFW3PFX38Q5`; G5b `bd-01M5ZC7XTJB9P7B2ZWZP8TD88N`; G6 `bd-01M5ZC7YKE9KC03PQW6E900R3C`; GQ `bd-01M5ZC7ZDCH3YTAR9R8132QGA4`.

Each slice may land only after its own checks; no merge/push/deploy is authorized by this plan. Keep the existing certification epic separate. Local implementation is recorded separately from unresolved external and broad performance qualification; the delivery epic is not closed by local checks alone.

## 13. Sources and reuse boundary

Workbench sources below are pinned to the reviewed commit. They document reference behavior; they do not license wholesale copying into this MIT project.

- [Licensing and exceptions](https://github.com/Washington-University/workbench/blob/c114f466f91a1c89256530e7fc94b8b464fd43c7/README#L30): mostly GPL-2.0-or-later; explicit MIT exception for `SurfaceResamplingHelper.cxx`; restricted FSL/MSM exceptions elsewhere.
- [Border tracing](https://github.com/Washington-University/workbench/blob/c114f466f91a1c89256530e7fc94b8b464fd43c7/src/Files/BorderTracingHelper.cxx) and [surface attachments](https://github.com/Washington-University/workbench/blob/c114f466f91a1c89256530e7fc94b8b464fd43c7/src/Files/SurfaceProjectionBarycentric.cxx).
- [Geodesic helper](https://github.com/Washington-University/workbench/blob/c114f466f91a1c89256530e7fc94b8b464fd43c7/src/Files/GeodesicHelper.cxx) and [command semantics](https://www.humanconnectome.org/software/workbench-command/-surface-geodesic-distance).
- [Smoothing implementation](https://github.com/Washington-University/workbench/blob/c114f466f91a1c89256530e7fc94b8b464fd43c7/src/Files/MetricSmoothingObject.cxx), [smoothing options](https://www.humanconnectome.org/software/workbench-command/-metric-smoothing), and [cluster areas](https://github.com/Washington-University/workbench/blob/c114f466f91a1c89256530e7fc94b8b464fd43c7/src/Algorithms/AlgorithmMetricFindClusters.cxx).
- [Resampling implementation](https://github.com/Washington-University/workbench/blob/c114f466f91a1c89256530e7fc94b8b464fd43c7/src/Files/SurfaceResamplingHelper.cxx); its [header remains GPL-labelled](https://github.com/Washington-University/workbench/blob/c114f466f91a1c89256530e7fc94b8b464fd43c7/src/Files/SurfaceResamplingHelper.h), and [SignedDistanceHelper has a restricted exception](https://github.com/Washington-University/workbench/blob/c114f466f91a1c89256530e7fc94b8b464fd43c7/src/Files/SignedDistanceHelper.cxx).
- [Ribbon implementation](https://github.com/Washington-University/workbench/blob/c114f466f91a1c89256530e7fc94b8b464fd43c7/src/Files/RibbonMappingHelper.cxx) and [mapping/coverage options](https://www.humanconnectome.org/software/workbench-command/-volume-to-surface-mapping).

Use independent implementations of the mathematical methods and SurfView's existing MIT geometry. No GPL source translation or Workbench WebAssembly bundle is part of this plan. Preserve the MIT notice if adapting the specifically permitted resampling implementation after the dependency audit.
