# Reliability and contracts

This page answers one question: what does SurfView guarantee at an application
boundary, and what remains the application's responsibility?

## Package and runtime contract

The npm package is named `surfview`. `three` is a required peer dependency;
React and React DOM are optional peers used only by the React entry points.

| Entry point | Contract | Format |
| --- | --- | --- |
| `surfview` | Viewer, surfaces, layers, loaders, serialization, and pure utilities | ESM import; CommonJS require and browser UMD compatibility in 2.x |
| `surfview/react` | React viewer and hook | ESM |
| `surfview/controls` | Host-mounted DOM controls | ESM |
| `surfview/controls/react` | React adapter for the controls | ESM |
| `surfview/report` | Portable report-scene runtime | ESM |

Every entry point has generated TypeScript declarations. The clean-consumer
gate installs the result of `npm pack`, imports every entry, checks the core
CommonJS path, and compiles strict TypeScript with dependency-library checking
enabled. The repository runs that gate on Node 22 and 24; `package.json`
declares Node 22 or newer for package tooling and server-side imports.

The core module can be imported in Node, but `NeuroSurfaceViewer` is a browser
object: construction requires a DOM, WebGL, and an application-owned container.
Pure numerical utilities are directly usable in Node. GIFTI parsing in Node
requires the caller to supply a `DOMParser` constructor.

## Ownership and lifecycle

The host application owns the container, input data, URLs, and application UI.
After `viewer.addSurface(surface, id)`, the viewer owns that surface's rendered
lifetime: replacement, `removeSurface(id)`, `clearSurfaces()`, and
`viewer.dispose()` detach and dispose it. Calling `surface.dispose()` directly
also removes the registered surface through the viewer's subscription.

The viewer owns its canvas, camera controls, render scheduler, picking objects,
post-processing resources, annotations, registered plugins, and WebGL renderer.
`dispose()` is idempotent, cancels pending work, releases those resources, and
removes the canvas from its host. A settled viewer has no recurring animation
frame; mutations call `requestRender()` and are coalesced into an on-demand
paint. `startRenderLoop()` is the resume operation after an explicit
`stopRenderLoop()`, not a requirement for ordinary rendering.

First-party controls remain outside the scene graph. The host owns the panel
container and the handle returned by `mountSurfViewControls()`; calling the
handle's idempotent `dispose()` removes its DOM and subscriptions. Report scenes
use `ReportSceneControlTarget` so manifest labels, units, legends, provenance,
and displayed-map policy are preserved.

## Loader validation and failure behavior

`loadSurface()` accepts GIFTI, FreeSurfer triangle surfaces, and the documented
ASCII PLY subset. It detects formats from URL pathnames without being confused
by query strings or fragments. Explicit laterality wins over valid GIFTI
metadata, which wins over an unambiguous filename token; otherwise laterality
remains `unknown`.

The loader enforces a caller-reducible body limit with a hard maximum of 500
MiB, at most 10,000,000 vertices, and at most 20,000,000 faces. It rejects
truncated arrays, impossible dimensions, non-finite coordinates, non-integer or
out-of-range face indices, unsupported encodings, malformed headers, and
invalid curvature lengths before returning a `SurfaceGeometry`. Timeout and
caller cancellation remain active through body reading, decompression, parsing,
validation, and construction.

Failures throw `SurfaceLoadError` with stable `code`, `stage`, and `format`
fields. Because loading returns a new geometry and does not mutate a viewer, a
rejected promise cannot leave a partially registered surface. Applications
should catch the typed error and decide whether to retry, report, or fall back:

```ts
import { loadSurface, SurfaceLoadError } from 'surfview';

try {
  const geometry = await loadSurface('/surfaces/lh.pial.gii');
  // Construct and register the surface only after the promise resolves.
} catch (error) {
  if (error instanceof SurfaceLoadError) {
    console.error(error.code, error.stage, error.format);
  }
}
```

## Statistical semantics

`tToZ(t, df)` converts a signed Student-t statistic to the standard-normal
quantile with the same cumulative probability:

`z = Phi^-1(F_t(t; df))`.

Equivalently, it computes the exact two-tailed Student-t probability and applies
the sign of `t` to the normal-z magnitude. Positive non-integer degrees of
freedom are supported. The function rejects non-finite statistics and
non-positive or non-finite degrees of freedom. When the tail probability
underflows to zero, the finite result is capped at `+/-38`, matching `pToZ(0)`.
It is not the approximation `z = t`.

The following public-package example is executed from the packed archive:

<<< ../../examples/statistical-equivalence.js

The numerical suite also compares a grid of values with an independent R
oracle and checks zero identity, odd symmetry, monotonicity, continuity, extreme
inputs, and invalid domains. See [computational assurance](../testing/computational-assurance.md)
for what that evidence does and does not establish.

## Performance boundaries

There is no universal SurfView frame-rate claim. Mesh topology, layer count,
canvas size, device pixel ratio, update frequency, renderer, driver, and GPU all
matter. The checked benchmark matrix records 32k, 164k, and 324k vertices with
1, 4, and 8 layers, plus picking, synchronized WebGL work, memory, and bundle
budgets. The [benchmark report](../performance/benchmark-report.md) names the
runtime, runner, workload, repetitions, dispersion, and current ceilings.

GPU compositing is a capability-dependent optimization. Requesting it does not
guarantee activation; the surface verifies renderer limits and retains or
returns to the CPU path when the required capability is absent. Updating one
layer can upload one dirty texture slice, while visibility changes and reorders
may relocate and regenerate later visible slots. A full volume-data update is a
full 3D texture upload.

Local measurements and green local tests are candidate evidence. Hosted CI on
the exact commit, required platform jobs, and published artifacts are separate
release evidence. The [CI policy](../testing/ci-policy.md) defines those gates.

## Evidence map

- [Responsibility map](../architecture/responsibility-map.md) — module ownership
  and allowed dependency directions.
- [Computational assurance](../testing/computational-assurance.md) — oracles,
  properties, and risk-weighted coverage.
- [Benchmark report](../performance/benchmark-report.md) — reproducible workloads
  and limits.
- [Tooling and supply-chain policy](../testing/tooling-and-supply-chain.md) —
  direct dependency ownership, audit exceptions, package scripts, and archive
  policy.
- [CI policy](../testing/ci-policy.md) — required jobs, supported Node lines, and
  local-versus-hosted proof.
- [Certification report](../testing/final-certification.md) — exact local
  results, remaining hosted gates, and release boundary.
- [Generated API reference](/api/) — current exported symbols and declarations.
