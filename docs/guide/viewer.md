# Viewer

The `NeuroSurfaceViewer` is the main class that manages the Three.js scene, camera, lighting, and rendering.

The host application owns the container, layout observers, data sources, and
application UI. The viewer owns the canvas and every rendered resource
registered with it. This boundary determines cleanup: remove host observers in
the host, and call the viewer's idempotent `dispose()` for viewer resources.

## Creating a Viewer

```javascript
import { NeuroSurfaceViewer } from 'surfview';

const viewer = new NeuroSurfaceViewer(
  container,    // HTMLElement
  800,          // width
  600,          // height
  {
    backgroundColor: 0x1a1a1a,
    ambientLightColor: 0x404040,
    directionalLightIntensity: 0.8
  }
);
```

## Configuration Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `showControls` | boolean | false | Deprecated warning-only flag; enabled values do not create UI |
| `useControls` | boolean | false | Deprecated warning-only flag; enabled values do not create UI |
| `allowCDNFallback` | boolean | false | Deprecated warning-only flag; runtime CDN loading remains disabled |
| `backgroundColor` | number | 0x000000 | Scene background color |
| `ambientLightColor` | number | 0xb5b5b5 | Integer RGB color (`0x000000`-`0xffffff`) |
| `directionalLightColor` | number | 0xffffff | Integer RGB color (`0x000000`-`0xffffff`) |
| `directionalLightIntensity` | number | 1.6 | Finite nonnegative directional-light intensity |
| `preset` | string | `default` | Style preset: `presentation`, `paper-light`, `talk-dark`, `clinical-qc`, `retinotopy`, or `glass-brain-surface` |
| `initialZoom` | number | 12 | Positive finite initial camera distance |
| `rotationSpeed` | number | 2.0 | Positive finite mouse rotation sensitivity |
| `ssaoRadius` | number | 4 | Finite nonnegative SSAO radius |
| `ssaoKernelSize` | integer | 32 | SSAO kernel size from 1 through 64 |
| `rimStrength` | number | 0 | Finite nonnegative rim-light strength |
| `metalness`, `roughness` | number | 0.1, 0.6 | Finite values in `[0, 1]` |
| `hoverCrosshairSize` | number | 1.2 | Positive finite crosshair size |

The constructor and `updateConfig()` validate the complete normalized
configuration before changing viewer state. Passing `undefined` cannot erase a
required runtime default. Invalid numeric values throw
`NumericValidationError` and do not change the camera, renderer, revision, or
events.

SurfView's published declarations use TypeScript exact optional-property
semantics: omit an option to preserve or select its default. Explicit
`undefined` is not a reset value and is rejected by TypeScript. Where an API
supports clearing state, its type names the reset value (normally `null`).
Plain JavaScript objects that contain an explicit `undefined` are normalized as
if that property had been omitted, including during state restoration.

## Methods

### Surface Management

```javascript
// Add a surface
viewer.addSurface(surface, 'brain');

// Remove and dispose a surface by its registered ID
viewer.removeSurface('brain');

// Get a surface by ID
const surface = viewer.getSurface('brain');
```

After `addSurface(surface, id)`, replacement, `removeSurface(id)`,
`clearSurfaces()`, and `viewer.dispose()` dispose that registered surface. Do
not dispose it a second time as part of the normal removal path. If a surface is
disposed directly, the viewer observes its disposal and unregisters it.

### Camera Controls

```javascript
// Center camera on all surfaces
viewer.centerCamera();

// Set a specific viewpoint
viewer.setViewpoint('lateral');  // lateral, medial, dorsal, ventral, anterior, posterior

// Get current camera position
const pos = viewer.getCameraPosition();

// Positive finite camera distance
viewer.setZoom(14);

// Legacy camera snapshots are validated atomically before application.
viewer.setCameraState({
  position: [0, 0, 14],
  rotation: [0, 0, 0, 'XYZ'],
  target: [0, 0, 0]
});

// A finite nonnegative total separation; negative/NaN values are rejected.
viewer.separateHemispheres(20);

// Disable and restore camera/surface interaction
viewer.setInteractionEnabled(false);
viewer.setInteractionEnabled(true);

// Access the interaction controller when direct tuning is necessary
viewer.cameraControls.rotateSpeed = 1.5;
```

Camera position, rotation, target, zoom, and hemisphere separation must be
finite. A camera-state update validates every supplied tuple before changing
any camera or control object.

For control surfaces and other reusable integrations, use the explicit
anatomical-view API instead of relying on the first loaded surface:

```javascript
import { ANATOMICAL_VIEWS } from 'surfview';

const registration = viewer.registerBilateralSurfaceGroup({
  id: 'cortex',
  leftSurfaceId: 'lh',
  rightSurfaceId: 'rh'
});
if (!registration.ok) throw new Error(registration.message);

const result = viewer.setAnatomicalView('dorsal', {
  layout: 'paired',
  groupId: 'cortex',
  fit: true,
  hemisphereGap: 8
});
if (!result.ok) throw new Error(result.message);

console.log(ANATOMICAL_VIEWS);
console.log(viewer.getAnatomicalViewCapabilities());
viewer.resetAnatomicalView();
```

`AnatomicalView` is the shared `lateral`, `medial`, `dorsal`, `ventral`,
`anterior`, and `posterior` vocabulary. A single layout must name a
`surfaceId`; a paired layout must name a registered `groupId`. Loading left and
right surfaces never creates a group. Registration requires existing,
distinct surfaces with matching hemisphere metadata, and a surface can belong
to at most one group. Invalid commands return typed failures without changing
camera or group state.

The ordinary viewer remains a camera-oriented adapter. For paired lateral and
medial views it uses the registered left member as the camera reference and
does not transform either mesh. Report scenes use the same orientation
fixtures but can rotate and arrange each registered member independently.
`fit: false` preserves camera distance while retargeting and reorienting;
`resetAnatomicalView()` restores the configured origin and zoom. Removing a
group member emits `surface-group:removed` with `reason: 'surface-removed'` and
invalidates the `surfaces` state domain.

`viewer.cameraControls` is the canonical interaction-controller property.
`viewer.controls`, `enableControls()`, and `disableControls()` remain deprecated
2.x aliases; the methods forward to `setInteractionEnabled()` and are removed in
SurfView 3.

## Pane-era API migration

The disabled Tweakpane implementation and all pane DOM, binding, dragging,
minimizing, and FPS-monitor state have been removed. The following members
remain only to make the 2.x migration explicit:

| 2.x compatibility member | 2.x behavior | Replacement | v3 |
|--------------------------|--------------|-------------|----|
| `showControls`, `useControls`, `allowCDNFallback` | Accepted; enabled values warn once and are normalized to `false` | Report controls, a `ViewerPlugin`, or application-owned controls | Removed |
| `toggleControls()`, `getControlsVisible()` | Warning no-op; visibility is always `false` | Track panel visibility in the application | Removed |
| `togglePaneMinimized()`, `minimizeControlsPane()`, `restoreControlsPane()` | Warning no-op | Track disclosure in the application | Removed |
| `updateIntensityRange()`, `updateThresholdRange()`, `updateDataRange()` | Warning no-op | `updateLayer()` or the corresponding layer setter | Removed |
| `updateColormap()` | Still updates the legacy selected/fallback map and warns | `updateLayer(surfaceId, layerId, { colorMap })` or `updateColorMap()` | Removed |
| `controls`, `enableControls()`, `disableControls()` | Deprecated interaction aliases | `cameraControls`, `setInteractionEnabled()` | Removed |

No compatibility member mounts DOM, loads a package, changes panel state, or
participates in the future first-party controls architecture.

### Rendering

```javascript
// Automatic on-demand rendering is enabled at construction. This is also the
// resume operation after stopRenderLoop(). It requests one coalesced frame.
viewer.startRenderLoop();

// Pause automatic rendering and cancel a pending frame
viewer.stopRenderLoop();

// Invalidate the view. Repeated calls before the next frame are coalesced.
viewer.requestRender();

// Paint synchronously (unless disposed or the WebGL context is lost)
viewer.render();
```

The viewer does not keep a permanent `requestAnimationFrame` loop alive. A
settled viewer has no pending frame. Layer changes, temporal `timechange`
handlers, resize operations, and camera controls call `requestRender()` as
needed. Trackball interaction temporarily owns follow-up frames while the
pointer is active or damping is still moving the camera, then releases them
when movement settles. `start()` and `stop()` are compatibility aliases for
`startRenderLoop()` and `stopRenderLoop()`.

WebGL context loss cancels the pending frame and suppresses rendering. A live
viewer requests one fresh frame after context restoration. `dispose()` is
idempotent and terminal: it cancels queued work, removes canvas, control, and
context listeners, releases GPU resources, and prevents `start()`, restoration,
or later invalidations from restarting the viewer. Applications remain
responsible for removing listeners they attach themselves, such as the resize
listener below.

### Resize

```javascript
window.addEventListener('resize', () => {
  viewer.resize(window.innerWidth, window.innerHeight);
});
```

Width and height must be positive finite CSS-pixel values. `dpr` must be
positive and finite; SurfView caps it at the exported
`MAX_DEVICE_PIXEL_RATIO` value (`4`) to bound framebuffer allocation. Validation
happens before any renderer, camera, surface, event, or revision mutation:

```javascript
const actual = viewer.resize(1200, 800, { dpr: window.devicePixelRatio });
console.log(actual.dpr); // <= 4
```

### State Serialization

Viewer state uses the version-2 schema. It records each surface's exact
bottom-to-top `layerOrder`, explicit bilateral `surfaceGroups`, and the
scientific `inspectionSelection`. It deliberately does not record a panel's
focused surface or layer, expanded sections, advanced visibility, or range-lock
preferences.

```javascript
const state = viewer.toJSON();
const url = viewer.toURL();

const report = viewer.fromJSON(state);
if (!report.success) {
  console.error(report.errors);
}
```

`fromJSON()` accepts both v2 and legacy v1 state throughout the SurfView 2.x
compatibility window. V1 layer order is migrated by ascending `LayerState.order`;
a missing or non-finite order uses the legacy default `0`, and source-array
position breaks ties. Legacy `selectedSurfaceId` and `selectedLayerId` values
were pane focus and are ignored. The only v1 crosshair promoted to scientific
selection is one that is visible, has `mode: 'selection'`, names a non-empty
surface ID, and has a non-negative integer vertex index.

Restoration validates every numeric domain, surface, layer-order, group, and
selection reference before changing canonical viewer state. Encoding and
serialization reject non-finite values instead of allowing `JSON.stringify()`
to turn them into `null`. Invalid references are returned in
`report.errors` with a stable `code`, `path`, and `message`; validation failure
does not partially restore the camera or any other section.

### Scene Export

```javascript
const scene = viewer.exportScene({
  id: 'sub-01-activation',
  provenance: {
    sourceFiles: ['sub-01_task-localizer_zstat1.nii.gz']
  }
});

const json = viewer.exportSceneJSON({ id: 'sub-01-activation' });
const html = viewer.exportStaticHTML({
  id: 'sub-01-activation',
  title: 'Subject 01 activation',
  scriptUrl: './surfview.es.js'
});
```

`exportScene()` captures the current serialized viewer state plus provenance, asset references, software version, and optional `SubjectPackage` metadata. `exportStaticHTML()` embeds that scene manifest in an HTML shell for later hydration. Its default module URL is the local `./surfview.es.js`; it never inserts a CDN URL.

### Style Presets and Figure Export

```javascript
import { getStylePreset, listStylePresets } from 'surfview';

viewer.applyStylePreset('paper-light');

const png = viewer.exportPNG({
  preset: 'paper-light',
  width: 2400,
  height: 1800,
  transparent: true,
  colorbar: true,
  colorbarLabel: 'z',
  colorbarRange: [-3, 3],
  roiLabels: [{ text: 'V1', x: 0.62, y: 0.36, normalized: true }],
  scaleBar: true,
  scaleBarLabel: '20 mm',
  title: 'Subject 01'
});

console.log(listStylePresets(), getStylePreset('paper-light').figure.dpi);
```

Style presets control the viewer background, lighting, material defaults, curvature display parameters, annotation defaults, ROI/export label styling, colormap defaults, export dimensions, and font scale. `paper-light` is an appearance preset, not a report behavior mode. `exportPNG()` renders at the requested pixel size and returns a PNG data URL; `dpi` is retained as figure intent because browser PNG encoders do not reliably write DPI metadata.

### Alignment QA

`AlignmentQAWorkspace` renders sagittal, coronal, axial, and 3D overlay panels for checking an explicit surface-to-volume transform. It reports transform metadata, surface-to-volume bounds distance, edge-gradient samples, and dropout-style low-intensity overlap.

```javascript
import { AlignmentQAWorkspace } from 'surfview';

const qa = new AlignmentQAWorkspace(container, {
  volume: {
    id: 'boldref',
    data: boldrefData,
    dims: [nx, ny, nz],
    space: 'boldref'
  },
  surfaces: [
    { id: 'white', kind: 'white', vertices: whiteVertices },
    { id: 'pial', kind: 'pial', vertices: pialVertices }
  ],
  transform: {
    id: 'anat-to-boldref',
    from: 'anat',
    to: 'boldref',
    matrix: anatToBoldref,
    provenance: { source: 'fMRIPrep' }
  }
});

console.log(qa.getReport().metrics.surfaceVoxelDistance);
```

### Cleanup

```ts
const observer = new ResizeObserver(() => {
  // host-owned layout work
});
observer.observe(container);

// During application teardown:
observer.disconnect(); // host-owned
viewer.dispose();      // viewer-owned; safe to call more than once
```

`viewer.dispose()` cancels scheduled frames, removes viewer and WebGL-context
listeners, disposes registered plugins and surfaces, releases camera controls,
post-processing, picking, annotations, renderer resources, and the WebGL
context, and removes the canvas from its host. It is terminal: later
invalidations and context restoration cannot restart rendering.

## Picking and Interaction

```javascript
// Pick at screen coordinates
const hit = viewer.pick({ x: event.clientX, y: event.clientY });

if (hit.surfaceId && hit.vertexIndex !== null) {
  console.log(`Hit surface ${hit.surfaceId} at vertex ${hit.vertexIndex}`);
}
```

### Scientific Selection and Vertex Inspection

Inspection selection is canonical scientific state, separate from a panel's
focused layer, annotations, and crosshair rendering:

```javascript
const result = viewer.setInspectionSelection({
  kind: 'vertex',
  surfaceId: 'brain',
  vertexIndex
});
if (!result.ok) throw new Error(result.message);

const selection = viewer.getInspectionSelection();
const inspection = viewer.inspectVertex('brain', vertexIndex);

console.log(inspection?.world);  // frozen [x, y, z] world tuple
for (const layer of inspection?.values ?? []) {
  console.log(layer.layerId, layer.label, layer.value, layer.units, layer.missing);
}

viewer.clearInspectionSelection();
```

The selection union is `none`, `vertex`, or `parcel`. Parcel selections carry
stable surface and parcel IDs plus optional representative vertex and atlas
IDs. Invalid surfaces, vertices, parcels, and atlas mismatches return typed
failures without changing the current selection. A removed surface clears a
selection that refers to it.

`inspectVertex()` returns `null` for an absent, out-of-domain, or disposed
target. Successful results contain only frozen plain data: stable IDs, a world
coordinate tuple, null-safe sample values, and optional parcel/atlas
descriptors. UI code never needs access to a layer's sparse indices and never
receives live layers, surfaces, Three.js objects, or typed arrays.

Crosshair rendering is opt-in when setting selection:

```javascript
viewer.setInspectionSelection(
  { kind: 'vertex', surfaceId: 'brain', vertexIndex },
  { showCrosshair: true }
);
```

Mouse clicks and `setParcelSelection()` update canonical inspection selection
while preserving their existing compatibility events. Calling
`showCrosshair()` alone does not change scientific selection.

### Crosshair

```javascript
// Show crosshair at a vertex
viewer.showCrosshair('brain', vertexIndex, {
  size: 2,
  color: 0xffcc00
});

// Hide crosshair
viewer.hideCrosshair();

// Toggle crosshair
viewer.toggleCrosshair();
```

### Annotations

```javascript
// Add annotation marker
viewer.addAnnotation('brain', vertexIndex, { label: 'ROI' });

// List all annotations
const annotations = viewer.listAnnotations('brain');

// Remove annotations
viewer.removeAnnotations('brain');
```
