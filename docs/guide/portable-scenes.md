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
      baseUrl: document.baseURI
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
| `selectLayer(id)` | Changes the displayed map and legend without replacing geometry. |
| `setView(view)` | Sets a coordinated bilateral lateral, medial, dorsal, ventral, anterior, posterior, or reset view. |
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
DOM toolbar for map selection, coordinated views, reset, and PNG export. You
can use a different appearance preset without changing that behavior.

## Tweakpane migration

Tweakpane is no longer a runtime dependency. `showControls`, `useControls`,
`allowCDNFallback`, and `toggleControls()` remain as deprecated compatibility
no-ops for the 2.x line. Passing an enabled legacy option emits one warning and
does not import, fetch, instantiate, or display Tweakpane.

Use one of these replacements:

- use `mountSurfView(..., { controls: true })` for generated reports;
- build application controls against viewer methods and events;
- use a `ViewerPlugin` for reusable application-specific behavior.

The deprecated compatibility members are scheduled for removal in SurfView 3.
