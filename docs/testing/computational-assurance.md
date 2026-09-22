# Computational assurance and coverage policy

SurfView's test policy treats coverage as a backstop for explicit scientific
and lifecycle contracts. A high aggregate percentage cannot compensate for a
missing oracle, an untested backend, or a zero-coverage critical module.

## Named invariant suites

| Risk domain | Executable contract | Main evidence |
| --- | --- | --- |
| Statistics | Valid domains; finite bounded outputs; `tToZ(0, df) = 0`; odd symmetry; monotonicity in `abs(t)`; continuity in `df` | `statistics.test.ts` compares 40 points against an independently generated R upper-tail oracle and adds metamorphic/adversarial cases. |
| Loaders | Exact geometry and laterality; dimensions and encodings agree; finite coordinates; bounded indices and allocation; atomic typed failure | `loaders.test.ts` covers ASCII, Base64, gzip, zlib, endian routes, truncation, malformed XML/headers, non-finite values, hostile lengths, invalid UTF-8, aborts, deadlines, and `maxBytes`. |
| Geometry | Valid adjacency indices; symmetric neighborhood construction; finite curvature; normalization bounds | `curvature.test.ts`, `numeric-validation.test.ts`, `loaders.test.ts`, and adjacency assertions in `statistics.test.ts`. |
| Blending | Straight-RGBA Porter-Duff semantics; opacity applied once; mode and order laws; transparent/opaque boundaries | `rgba-compositing.test.ts` uses hand-derived results and a separate scalar oracle; `gpu-compositing.spec.ts` reads pixels from the production shader and compares them to that oracle. |
| Lifecycle | One coalesced frame; zero recurring RAF when settled; context-loss pause/recovery; idempotent listener/resource disposal | Direct scheduler/context tests, `viewer-lifecycle.test.ts`, and `viewer-lifecycle.spec.ts` in a real browser. |
| Picking transforms | Screen-to-NDC conversion; world transforms; closest face/vertex; miss/null contract; CPU/GPU metadata | `picking.test.ts`, `viewer-picking-controller.test.ts`, `GPUPicker.test.ts`, and cortical-scale GPU picking in `performance-benchmark.spec.ts`. |
| Serialization | Versioned round-trip; finite/schema/reference validation; stable order; legacy selection rule; no partial mutation | `serialization.test.ts` exercises corrupted/future payloads, invalid numbers and references, migration fixtures, event reports, and transactional restoration. |

## Rendering evidence layers

Rendering claims require distinct evidence because one layer cannot substitute
for another:

1. Pure algebra: `rgba-compositing.test.ts` checks hand-derived scalar and
   full-buffer results without WebGL.
2. GPU readback: `gpu-compositing.spec.ts` renders the production GLSL path to a
   target, reads pixels, and compares every supported blend case with the pure
   oracle.
3. Browser behavior: surface, volume, controls, lifecycle, gzip, embed, and
   regression Playwright suites exercise real package behavior.
4. Visual baselines: the required macOS visual-regression job runs
   `controls-panel.spec.ts` with `SURFVIEW_GOLDEN_SNAPSHOTS=1` and compares the
   first-party control layouts with reviewed snapshots. The Ubuntu browser job
   retains cross-platform functional and image-change assertions without
   pretending a missing platform baseline is a pass. These snapshots cover
   presentation only; they are not numerical or shader oracles.

## Risk-weighted thresholds

`vitest.config.ts` enforces a modest global floor and higher reviewed thresholds
for the critical modules below. The exact-file gates are evaluated separately,
so excess coverage elsewhere cannot hide a drop.

| Boundary | Branch floor | Why |
| --- | ---: | --- |
| Statistics | 85% | Numerical domains, tails, and invariants |
| Loader boundary | 68% | Multiple encodings and adversarial failure routes |
| Mesh adjacency / curvature | 90% / 72% | Geometry integrity and degenerate meshes |
| RGBA composition / validation | 90% / 90% | Renderer semantics and transactional input safety |
| CPU picking / GPU picker | 55% / 30% | Pure transforms plus browser-only WebGL paths |
| Viewer state / serializer / deserializer | 78% / 48% / 58% | Versioning and atomic restoration |
| Picking, render, and WebGL lifecycle controllers | 48% / 82% / 85% | State-machine and resource ownership |
| React viewer / hook | 48% / 24% | Shipped optional entry, including SSR and StrictMode behavior |

The lower GPU-picker and React-hook branch floors reflect code that must execute
in a browser or React lifecycle and is also covered by Playwright or fixture
builds. They are explicit ratchets, not permission to replace those integration
tests with unit coverage.

Only declaration files are excluded. Type-only barrels remain visible as zero
runtime coverage because they emit no runtime behavior; critical implementation
files are named individually. Coverage includes `src/react/**/*.ts(x)` and
`src/index.react.ts`.

## CI behavior

`npm run test:coverage` is the CI unit command. It fails both the global and
critical-file thresholds and writes text, JSON summary, and LCOV reports. CI
publishes the complete `coverage/` directory even after failure so reviewers can
distinguish a real critical regression from instrumentation or runner trouble.

Large deterministic performance cases have separate time/memory budgets. See
the [performance benchmark report](../performance/benchmark-report.md) for the
noise policy and stored baselines.
