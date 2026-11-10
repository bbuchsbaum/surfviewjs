# Quantitative flatmap and relief delivery receipt

2026-10-28. Implemented locally on SurfViewJS base `a05f87fcd98a6e0c3766092b74a105bec10d44c6`, package 3.1.0. The feature changes are uncommitted and unpublished. `source-receipt.json` identifies the owned source files, built artifacts and final evidence by SHA-256; it does not incorporate unrelated worktree changes.

## Delivered workflow

Run `npm run demo`, then choose **Anatomy → Flat map** (route `/demo/index.html?scenario=anatomy&mode=flatmap`). The same entry supports quantitative surface/volume values, depth and support inspection, persistent anatomical points, relief exaggeration, area distortion, ROI drawing/exports and independent PNG/JSON export. The demo uses public APIs from `surfview` and the new optional `surfview/flatmap` entry.

The modular implementation separates admitted chart/correspondence, rasterization, sampling, bounded caches, controller lifetimes, presentation and anatomical display deformation. Existing legacy flatmaps and ordinary vertex-color surfaces retain their paths. No runtime dependency was added.

- [User guide](../../docs/guide/quantitative-flatmaps.md)
- [Public consumer example](../../examples/quantitative-flatmap.ts)
- [Plan and delivery decisions](../../docs/architecture/quantitative-flatmap-relief-plan.md)
- [Dataset provenance and restoration](../../demo/data/flatmap/README.md)

## Matched anatomy and independent numerical evidence

The pinned pycortex S1 left dataset contains matched real white/pial/inflated surfaces: **152,893 anatomical vertices and 305,782 faces**. Runtime chart admission retains **291,063 flat faces** after explicitly excluding 288 inverted/overlapping source faces. One disconnected cut fan is duplicated, giving **152,894 chart vertices** with original anatomical identities. No anatomical coordinates are repaired, and no MNI registration is inferred. The chart has arbitrary units and explicit display calibration. The compressed local asset is 8,988,236 bytes; SHA-256 `40fba3dc46ff47bb55c0fd90295e1d63cc32821f2370cabfe2316113b03495c9`. Repository BSD-2-Clause terms are retained; no separate per-asset license was found. Functional scalar and volume values are constructed and labeled.

`reference.py` extracts only the named functions from pycortex revision `1e4c0790b66bcbcd836b5832650908f83327c399`, records their source hashes, and bypasses smoothing to expose raw folding height. It evaluates complete anatomical topology using float64 arithmetic over original float32 geometry. It also constructs an independent closed-form affine-volume witness with separately enumerated voxel-support masks. This is not an end-to-end pycortex rasterization comparison.

| Witness | Locations | Maximum absolute error | Support agreement |
| --- | ---: | ---: | --- |
| Pinned pycortex raw folding height | 130 | 7.11e-15 mm (RMS 9.51e-16) | Active chart vertices, including extrema |
| Independent analytic volume | 128 | 5.55e-16 | Zero mask differences; coverage error 0 |
| Direct versus prepared sampling, same real chart window | 4,096 pixels × 8 depths | 3.33e-16 | Zero mask differences |

The predeclared raw/volume tolerance is 1e-10; coverage tolerance is 1e-12. Ordinary unit tests additionally cover hand-computed triangles, cut/seam correspondence, overlap rejection, reflected components, constant/affine/multilinear fields, sheared affines, missingness, depth-mean versus ribbon-volume semantics, analytic area ratios/distortion, slopes, disconnected smoothing, mutation isolation and cancellation ownership.

Relief smoothing is **`log-gaussian-relief-v1`**, an area-weighted Gaussian in log height on the cut chart. It deliberately differs from pycortex's screened-Poisson smoother. Finished relief equivalence is not claimed. Anatomical metrics and sampling positions remain unchanged by display exaggeration.

## Executed local checks

| Gate | Result |
| --- | --- |
| `npm test` | 1,285 tests in 115 files passed |
| Core/demo/contract/package TypeScript checks | Passed; demo checking includes the new browser fixtures |
| `npm run lint` | Passed, zero errors; one pre-existing unused `position` warning in `src/annotations.ts` |
| Library build and packed consumer audit | Passed; optional entry shares core class/domain/registry identities and canonical examples compile |
| Bundle limits | Core 176,546 B Brotli / unchanged 180 kB limit; optional flatmap about 15.17 kB / 20 kB limit |
| Demo build and strict TypeDoc/VitePress build | Passed; generated guide, plan, API pages and navigation links resolve |
| Full installed-Chromium Playwright suite | 86/86 passed, including existing geometry/worker/picking/gallery paths |
| New quantitative browser contracts | Worker/local values and masks, CPU/WebGL2/3D color parity ≤1 byte, context restoration, clipping/picking, mixed-material redraw, independent exports and zero retained resources passed |
| Final real-data visual workflow | Repeated after the final landmark/caption/readout changes; pin, depth, relief, distortion, ROI, PNG provenance, responsive layout and chapter cleanup passed |

The final changes after the full 86-test pass were a visible default landmark, narrow caption sizing, and the distortion readout label; the affected real-data workflow was rerun. Raw logs are retained under `logs/`. TypeDoc emitted no warnings. VitePress retains its existing large-chunk advisory; no limit or warning policy was relaxed. Hosted CI and publication were not run.

## Performance and limits

One local run, Chromium 151, DPR 1, 14 reported hardware threads, **ANGLE SwiftShader software rendering**. Timings are observations, not cross-device guarantees. See `performance.json` for all inputs and metrics.

Real data fetch/decompression/admission: **582.2 ms**. Worker relief preparation at 2.5 mm FWHM: **8.20 s**, retaining 4,433,926 bytes. Display construction plus three warmup frames: 189.3 ms. These cold costs remain visible loading/preparing phases.

For the same 64×64 real window with eight depths: raster 3.1 ms, prepare 3.2 ms, apply 2.4 ms; direct inspection 15.2 ms. Preparation is reusable while inputs match. These measurements compare execution paths within SurfView, not speed against pycortex.

The matrix uses square grids, 64×64 tiles, a 64 MiB controller cache (48 MiB plans / 16 MiB values), uniform midpoint depths in [0.2,0.8], a fixed affine field and fixed missing slab. `frame` means applying changed values; it excludes presentation. Plan counts span cold + identical repeat + changed frame.

| Grid | Depths | Cold ms | Same-frame repeat ms | Changed frame ms | Complete numerical frames/s | Plan builds |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| 512² | 1 | 616.0 | 1.2 | 18.1 | 55.25 | 64 → 64 |
| 512² | 8 | 624.1 | 0.9 | 165.7 | 6.04 | 64 → 128 |
| 512² | 32 | 789.9 | 0.8 | 369.8 | 2.70 | 64 → 128 |
| 1024² | 1 | 757.2 | 382.2 | 371.9 | 2.69 | 256 → 768 |
| 1024² | 8 | 1049.3 | 677.0 | 662.6 | 1.51 | 256 → 768 |
| 1024² | 32 | 1881.3 | 1447.7 | 1435.7 | 0.70 | 256 → 768 |
| 2048² | 1 | 1902.6 | 1456.4 | 1483.2 | 0.67 | 1024 → 3072 |
| 2048² | 8 | 2973.4 | 2422.9 | 2455.2 | 0.41 | 1024 → 3072 |
| 2048² | 32 | 6268.8 | 5757.6 | 5780.9 | 0.17 | 1024 → 3072 |

At 512² with one depth the plan remains cached. With more depths or larger grids, retained stencils exceed the plan cache and scans rebuild evicted plans. Cached unchanged values can still make the identical repeat fast at 512². No blanket 60 fps playback claim is made. Peak sampled worker retention in this matrix is 95.1 MiB, within its 256 MiB component limit. Every matrix controller disposal returned retained worker bytes to zero.

Warm CPU deformation commit p95: **3.4 ms**. LUT GL submission p95: **0.3 ms**. Two animation callbacks after the update: p95 **17.7 ms**. The bounded warm window observed 0 main-thread tasks above 50 ms. Lookup p95 rounded to zero at browser timer resolution; it is **not zero-cost**. Synthetic 10k/32.4k/164k chart construction is recorded separately.

The initial measurement mistakenly included display setup in its interaction window and saw two tasks up to 102 ms. That adverse receipt is preserved as `performance-including-setup.json`. The final harness explicitly records setup, warms three frames, then observes the steady window. It does not erase or reclassify cold cost as fast interaction.

Cancellation was acknowledged in **1.4 ms** after aborting a warmed 2048²/32-depth job, with zero stale commits and zero pending jobs. Final worker diagnostics were zero resources, retained bytes and pending jobs.

**Qualification boundary:** the interaction harness evaluates CPU deformation and 2D GL submission; it does not draw the paired 3D scene, fence the GPU or measure photons. The planned full paired-view input-to-present ≤50 ms target remains unqualified on native hardware. Byte accounting bounds component arrays/resources, not all JavaScript object overhead, transfer peaks, browser allocations or driver memory. Synchronous chart admission and cold shader/setup tasks can exceed 50 ms. Viewport-only tile scheduling and texture residency are not implemented; grids stream into a bounded full-field texture.

## Visual specimens

The captures use the real matched anatomy. Functional values and the missing slab are synthetic; relief is display-only. Desktop specimens are 1440×900 and narrow specimens use a 390×844 viewport with full-page capture. Visual review confirmed scalar/coverage rendering, a visible anatomical pin, relief folding, distortion labels and separate legends/readouts after resize.

- [Quantitative map](map-desktop.png)
- [Tilted relief](relief-desktop.png)
- [Volume/depth/coverage](volume-desktop.png)
- [Area distortion](distortion-desktop.png)
- [Narrow map](map-narrow.png)
- [Narrow relief](relief-narrow.png)

## Reproduce

From the repository root, restore the dataset if necessary using `python3 scripts/prepare-flatmap-data.py` (Python + NumPy; pinned downloads are cached under `/tmp/surfview-pycortex-review/S1`). Then:

```sh
python3 benchmarks/2026-10-28-flatmap/reference.py
npm run dev:ci
# In a second shell, using the project's installed Playwright browser:
npx playwright test tests/e2e/quantitative-flatmap.spec.ts tests/e2e/flatmap-relief.spec.ts tests/e2e/chapter-anatomy.spec.ts --workers=1
node benchmarks/2026-10-28-flatmap/run.mjs
```

Follow the repository browser-ownership audit before/after automation and stop the owned server afterward. The benchmark and Playwright tests close their browser resources. There is no persistent automated browser or published demo from this delivery.
