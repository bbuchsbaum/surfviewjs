# Surface geometry implementation receipt

Date: 2026-10-27. Implementation is local and uncommitted, based on `7b44e4491c52f7cea4f0eaae6472d906de041010`. No publication, merge or deployment was performed. Unrelated workspace changes were preserved.

All six approved directions have public implementations, viewer/demo integration, and local validation. The [design](surface-geometry-plan.md) retains its original acceptance targets; passing the checks below does not establish all of those targets. The [guide](../guide/surface-geometry.md) and [executable example](../../examples/surface-geometry.ts) document the supported APIs.

## Delivered behavior and efficiency

| Direction | Implementation | Improvement and reuse |
| --- | --- | --- |
| Parcel boundaries | Shared two-label midpoint and three-label centroid partition; connected curves, junctions, editable controls, `OutlineLayer` midpoint mode | Fills and borders use the same partition; sparse edits update incident faces; morph/style updates reuse graph and rendering buffers |
| Geodesic interactions | Edge or unfolded triangle-pair index; radius/multi-source queries, virtual-endpoint paths, ROI dilation/erosion, penalties; ruler/brush controls | Typed indexed heap and visit generations avoid whole-mesh resets; cutoff searches touch local neighborhoods; retained worker indices reuse metric/graph setup |
| Precise attachments | Barycentric locations, morph-aware CPU picking and annotations; versioned anchor artifacts and explicit remapping | Referenced-vertex cache follows actual morph attributes/weights; marker instances grouped by parent surface and radius; geometry replacement requires explicit rebinding |
| Area operations | Vertex and partition area estimands, missing-data coverage, Gaussian smoothing, signed area cluster filter | Cached sparse weights and caller-owned output buffers for repeated maps; explicit row streaming when retaining a plan is inappropriate; derived temporal outputs own their buffers |
| Resampling | Validated scalar/categorical plans; checksummed interchange; registered-sphere closest-triangle and adaptive-area constructors | Packed AABB triangle search; deterministic edge/vertex projection; weights reused across frames, with distinct label voting and missingness semantics |
| Ribbon integration | Barycentric dual columns, consistent tetrahedralization, voxel-cell clipping, volume/coverage outputs and column inspector | Candidate-cell bounds avoid full-volume scans; selected-column construction; reusable sparse overlap weights for subsequent volumes |

Shared immutable domain/metric snapshots separate anatomical measurements from display changes. Explicit identities, copied inputs, topology diagnostics, budget errors, cancellation, stale-result guards and owned worker resources support every operation. No numerical runtime dependency was added, and no GPL source was translated or copied.

## Executed local checks

| Check | Result |
| --- | --- |
| `npm test` | 101 files, 1,196 tests passed, including 30 new geometry tests |
| `npm run type-check`, `type-check:demo`, `test:types` | Passed, including negative public API contracts |
| `npm run build`, `demo:build` | Passed; declarations and standalone module worker emitted |
| `npm run test:package-consumers` | Passed; core without optional peers, ESM/CommonJS, worker execution, canonical example compilation/execution |
| `npm run size` | Passed existing limits; core 171,252 bytes Brotli against 180 kB limit |
| Packed archive | 3,891,969 bytes compressed; 15,710,600 bytes unpacked, below existing 5/15 MiB ceilings |
| Focused native Playwright | 29 passed across surface geometry, Inspect, Anatomy, Statistics, Time series, Data in/out and Volume specs |
| `npm run docs:build` | Passed; local Markdown links and canonical example include checked separately |

The [verification receipt](../../benchmarks/surface-geometry-evidence-2026-10-27/receipt.json) retains source/bundle hashes, exact check commands, exit statuses and adjacent raw logs. The generated VitePress output was removed after the successful build to recover disk space when a tracker write failed; source, library/demo builds and evidence remain intact. Tracker updates then completed and its store passed `mote doctor` integrity checks.

Native tests check rendered marker pixels at five morph weights, precise hit coordinates, midpoint border positions, ESM/UMD/embed worker clients, released-handle refusal and retained dependencies. Demo checks exercise physical cluster controls, smoothing during frame changes, mapping download, a valid cortical display column, and existing chapter interactions. Project-owned browser processes were closed; the post-run ownership audit found none.

Independent numerical witnesses include analytic triangle/partition integrals, a symmetric continuous Gaussian density-bias example, unfolded diagonal distances, 100 triangle projections compared with Three.js exhaustive projection, exact tetrahedron/cell intersections, and slab volume/means under shear, scale and reflected voxel transforms. These fixtures establish the stated local contracts; they do not establish population-level anatomical accuracy.

## Measured synthetic baseline

The [machine-readable baseline](../../benchmarks/surface-geometry-2026-10-27.json) pins fixture and bundle SHA-256 hashes, options, runtime and hardware. It ran on Apple M3 Max, Node 26.7.0 and Three.js 0.185.1 using open planar unit-mm lattices. Query/application timings have one warmup and five samples; p95 is the largest of those five observations, not a stable tail-latency estimate. Construction has three samples, except smoothing construction, which has one.

| Vertices | 10 mm query p50 / p95 | One-vertex boundary edit p50 | 1 mm FWHM build | Cached smoothing apply p50 / p95 | Retained smoothing weights |
| --- | --- | --- | --- | --- | --- |
| 32,492 | 0.323 / 1.681 ms | 0.021 ms | 216.6 ms | 2.42 / 5.91 ms | 3.69 MiB |
| 163,842 | 0.038 / 0.106 ms | 0.008 ms | 722.6 ms | 5.49 / 5.64 ms | 18.69 MiB |
| 324,002 | 0.025 / 0.037 ms | 0.004 ms | 1,446.0 ms | 10.89 / 23.61 ms | 37.00 MiB |

Every radius query reached 285 vertices. Larger cases ran later in the same process, so JIT warmup and fixed local work explain why these numbers do not increase with total mesh size; they do not imply larger surfaces are intrinsically faster. The single-vertex edit times exclude complete curve retracing and GPU upload. Total-area error was at most `2.91e-11 mm²`.

The measured main-thread submission cost before the first yield was **61.7 / 309.1 / 600.9 ms**. This misses the proposed interactive task limit; use background worker construction for these sizes. Cancellation after the first yield took 0.92 / 1.40 / 1.57 ms in one attempt per size and is not a p95 guarantee. The cumulative process maximum RSS reached 1.25 GB, including benchmark results and garbage-collection timing; it is not an isolated kernel peak. These adverse results are retained alongside the fast cached operations.

## Qualification boundaries

- `wb_command` was unavailable. Workbench versioned output fixtures, command regeneration and external parity remain open, especially adaptive resampling and thin-column mapping. Methods are independently implemented and documented by their actual definitions.
- The full proposed matrix of cortical 32k/164k subjects, FWHM/radius sweeps, repeated frames, transfer/upload costs and isolated memory peaks has not been run. Synthetic measurements must not be substituted for those gates.
- Geodesics are named graph approximations. Smoothing preserves constants but does not promise area-integral conservation or exact achieved FWHM. Ribbon values average a piecewise-constant voxel field over the specified tetrahedral columns; local inversion/overlap rejection does not prove global anatomical non-overlap.
- Some topology/index and face-level setup is synchronous. Cooperative time slicing is not a hard latency bound. Background worker construction is available; submission time and post-yield cancellation are reported separately.
- Memory limits are explicit algorithm allocation budgets, not a process heap cap. Typed-array sizes are counted and JavaScript object storage is estimated. Retained plans fail rather than silently lowering accuracy; row-streamed smoothing is an explicit alternative.
- Shared-validity denominator caches and dedicated multi-frame batching are not implemented. Repeated callers reuse plans/output buffers; async calls copy each submitted frame. No broader batching speedup is claimed.
- Precise anchors and computation plans have separate versioned artifacts. Automatic linked-view anchor transfer and portable-scene replay of computations are not implemented; callers supply correspondence explicitly. The volume demo inspects individual columns, while the public plan API can construct the requested target set.

The first large benchmark correctly stopped at the default 128 MiB plan budget. The recorded larger run explicitly grants 512 MiB construction storage; the defaults were not raised. An earlier browser run had one existing volume test interrupted by a Vite reload during editing; the final source-stable run passed all 29 tests.

The npm archive has only about 18 kB of remaining unpacked-size allowance. Future additions should address packaging within the current limits rather than treating this run as a broad size margin.
