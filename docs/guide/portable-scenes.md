# Portable report scenes

`mountSurfView()` reconstructs a complete viewer from a versioned scene
manifest. Use it for generated reports, R htmlwidgets, and pages that must run
without a package manager or a network connection.

The browser embed is `dist/surfview.embed.iife.js`. It includes Three.js r185
exactly once and exposes the public API as `window.surfview`. It does not load
scripts, styles, fonts, or assets from a CDN.

## Mount a scene

```html
<div id="surface-report"></div>
<script src="./surfview.embed.iife.js"></script>
<script>
  const handle = surfview.mountSurfView(
    document.getElementById('surface-report'),
    manifest,
    {
      lazy: true,
      preset: 'paper-light',
      controls: true,
      baseUrl: document.baseURI,
      bilateralGroup: {
        id: 'cortex',
        leftSurfaceId: 'left',
        rightSurfaceId: 'right'
      }
    }
  );

  await handle.ready;
  handle.selectLayer('task-minus-rest');
  handle.setView('medial');

  // Release the observer, fetches, frame loop, WebGL context, and GPU resources.
  handle.dispose();
</script>
```

`mountSurfView()` validates `manifest.schemaVersion` before it creates an
observer, fetches an asset, requests an animation frame, or creates WebGL. The
current schema is `surfview.scene.v1`. An unknown version throws a
`SceneManifestError` synchronously.

The returned handle provides these operations:

| Operation | Result |
|---|---|
| `ready` | Resolves after assets, surfaces, controls, and the first view are ready. |
| `controlTarget` | The report-aware `SurfViewControlTarget` after `ready`; `null` while lazy, unmounted, or disposed. |
| `selectLayer(id)` | Changes the displayed map and legend without replacing geometry. |
| `setView(view)` | Sets a lateral, medial, dorsal, ventral, anterior, or posterior view. |
| `resetView()` | Restores the mount's configured `initialView`. Passing `reset` to `setView()` remains a deprecated compatibility form. |
| `getAnatomicalViewCapabilities()` | Returns the shared view vocabulary, single-surface IDs, and registered bilateral groups. |
| `resize(width?, height?)` | Resizes the renderer. A `ResizeObserver` also follows container width changes. |
| `exportPNG(options?)` | Returns a PNG data URL using the viewer's figure-export options. |
| `dispose()` | Cancels pending work and releases browser and GPU resources. Repeated calls have no effect. |

## Asset modes

A scene can carry its typed arrays inline as base64 or refer to adjacent binary
files. Both forms use canonical little-endian bytes:

- vertices, curvature, and map values use `Float32`;
- triangle indices and sparse value indices use `Uint32`;
- missing map values remain IEEE `NaN` values;
- every asset records its shape, byte length, role, endianness, and SHA-256;
- adjacent filenames contain the SHA-256 digest.

The loader verifies byte length and checksum before it constructs geometry. It
also rejects face or map indices outside the geometry's vertex range.

## `paper-light` and report behavior

`paper-light` is an appearance preset. It selects a white background, restrained
lighting and material values, curvature styling, label defaults, and
publication-oriented PNG defaults. It does not enable lazy loading, add a
toolbar, choose a layer, or change lifecycle behavior.

`mountSurfView()` supplies report behavior. Its `controls` option adds a small
DOM control surface for map selection, coordinated views, reset, and PNG
export. It uses native select, radio-group, and button semantics and does not
load the optional Lit controls bundle. You can use a different appearance
preset without changing that behavior.

The compatibility methods on the mount handle delegate to `controlTarget`.
Code that needs a different control surface can create an independent session
over that target after the mount is ready:

```js
await handle.ready;
const session = surfview.createSurfViewControlSession(handle.controlTarget);
// Each session keeps its own focused layer and disclosure state.
session.setDisplayedLayer('task-minus-rest');
session.dispose();
```

ESM applications should import `mountSurfView` from `surfview/report`.
SurfView 2.x still re-exports the report API from the root for compatibility,
but the explicit subpath is the forward-compatible entry and remains a thin
re-export of the core runtime.

Use the mount's report target rather than creating a `ViewerControlTarget` from
`handle.viewer`. The report adapter preserves the manifest's one-map policy,
joins manifest labels, units, legend metadata, and provenance into immutable
descriptors, and applies the report-specific paired mesh layout. The compact
toolbar and any additional sessions share canonical report state without
sharing panel-local focus. The compact toolbar creates and owns one independent
`SurfViewControlSession`; disposing it does not dispose the caller-owned report
target. A full panel mounted over the same target must use its own session.

A report with more than one surface must pass an explicit `bilateralGroup`.
The mount does not infer coordination from surface count, hemisphere names, or
object order. The named surfaces are registered with the viewer, validated as
left and right members, then independently oriented and separated by
`hemisphereGap`. A one-surface report needs no group. This report mesh-layout
mechanic deliberately differs from the ordinary viewer's camera-only paired
view, while both use the same six orientation definitions.

## Tweakpane migration

Tweakpane is no longer a dependency, and its pane construction, DOM, binding,
dragging, minimizing, and FPS-monitor implementation has been deleted.
`showControls`, `useControls`, and `allowCDNFallback` remain as warning-only 2.x
constructor flags. Passing an enabled option emits one warning, normalizes the
stored value to `false`, and does not import, fetch, instantiate, or display UI.

`toggleControls()`, visibility/minimize helpers, and the pane range update
helpers remain warning no-ops in 2.x. `updateColormap()` remains functional but
deprecated. Use `cameraControls` and `setInteractionEnabled()` for camera and
surface interaction; `controls`, `enableControls()`, and `disableControls()` are
deprecated aliases.

Use one of these replacements:

- use `mountSurfView(..., { controls: true })` for generated reports;
- mount the optional first-party panel with `mountSurfViewControls()` for
  application viewers;
- use a `ViewerPlugin` for reusable application-specific behavior.

All pane-era compatibility members and the ambiguous interaction aliases are
scheduled for removal in SurfView 3. See the [viewer migration table](./viewer.md#pane-era-api-migration)
for exact replacements.
