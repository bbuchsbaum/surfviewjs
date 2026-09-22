# Viewer and surface responsibility map

`NeuroSurfaceViewer` is the stable public facade. It coordinates the scene and
public API, while focused internal objects own state machines and algorithms.
The internal modules are deliberately not exported from the package root; this
keeps their boundaries changeable without widening the public compatibility
surface.

## Ownership

| Responsibility | Owner | Viewer role |
| --- | --- | --- |
| Renderer and WebGL context | Three.js renderer plus `WebGLContextLifecycle` | Configure the renderer and translate context transitions into public events and render invalidations. |
| Render scheduling and lifecycle | `ViewerRenderScheduler` using the shared `AnimationFrameDriver` | Supply readiness, controls, rendering, and event callbacks. `requestRender()`, `start()`, and `stop()` are facade methods. |
| Camera and named views | Three.js camera, camera controls, and the anatomical-view helpers | Coordinate camera state with surface bounds and public view commands. Camera policy stays here because it crosses renderer, controls, and registered surfaces. |
| Picking | `ViewerPickingController` and `GPUPicker` | Route pointer events into the controller, then translate pick results into inspection, parcel, annotation, and crosshair events. |
| Surface registry | The viewer's primary surface map plus `BilateralSurfaceGroupRegistry` | Own surface add/remove transactions and delegate bilateral membership, validation, and capabilities. |
| Layer composition | `MultiLayerNeuroSurface`, `GPULayerCompositor`, and `SurfaceColorUpdateScheduler` | Flush pending surface composition before a canvas render and relay layer events. |
| Figure export | Serialization/scene-export modules plus `FigureOverlayRenderer` | Coordinate temporary render sizing and world-to-screen annotation projection; delegate canvas overlay drawing. |
| Controls | `SurfaceControls`, TrackballControls, and the optional controls packages | Construct the selected control implementation and translate its lifecycle events into render scheduling and public events. |
| Viewer state revisions | `ViewerStateChangeTracker` | Map public mutations to control domains and provide batching around compound viewer operations. |

## Dependency and lifecycle rules

- Internal controllers depend on narrow callbacks or domain types. None imports
  `NeuroSurfaceViewer`, so ownership remains one-way and the extraction adds no
  dependency cycle.
- Each viewer owns exactly one `ViewerRenderScheduler`. Surface color
  composition has a separate per-surface coalescer, and a viewer render flushes
  it before painting so the two loops cannot race visibly.
- Animation-frame access is injected through `AnimationFrameDriver`; merely
  importing a module does not schedule work.
- WebGL and pointer listeners retain stable callback identities and are removed
  during disposal. Controllers have idempotent disposal paths.
- No extracted module reads `window` or `document` at import time. The browser
  animation APIs are referenced only when a driver method is called.
- The focused internal controllers are not root exports. The viewer's render,
  picking, view, serialization, and controls methods remain their public facade;
  declarations expose the public configuration and result types referenced by
  those methods.

## Characterization coverage

| Contract | Evidence |
| --- | --- |
| Lifecycle and disposal | `viewer-lifecycle.test.ts`, `webgl-context-lifecycle.test.ts`, `scene-mount-lifecycle.test.ts` |
| Event dispatch and batched revisions | `viewer-events.test.ts`, `viewer-state-change-tracker.test.ts` |
| Serialization and restoration | `serialization.test.ts`, `scene-export.test.ts` |
| CPU/GPU picking | `viewer-picking-controller.test.ts`, `GPUPicker.test.ts`, `inspection.test.ts` |
| Anatomical and bilateral views | `anatomical-view.test.ts`, `bilateral-surface-group-registry.test.ts` |
| Render dispatch and composition | `viewer-render-scheduler.test.ts`, `surface-color-update-scheduler.test.ts`, `viewer-lifecycle.test.ts` |
| Figure overlays | `figure-overlay-renderer.test.ts`, `controls-figure.test.ts` |

## How to evaluate the extraction

The extraction is judged by responsibility density and executable seams, not by
an unstable source-line snapshot. Implicit state and long facade methods became
named lifecycle objects, callback interfaces, invariants, and direct tests. The
package build independently enforces the current core and optional-entry bundle
budgets; the [benchmark report](../performance/benchmark-report.md) records the
measured artifact sizes and provenance for the current reference run.
