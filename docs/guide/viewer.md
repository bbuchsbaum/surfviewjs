# Viewer

The `NeuroSurfaceViewer` is the main class that manages the Three.js scene, camera, lighting, and rendering.

## Creating a Viewer

```javascript
import { NeuroSurfaceViewer } from 'surfview';

const viewer = new NeuroSurfaceViewer(
  container,    // HTMLElement
  800,          // width
  600,          // height
  {
    showControls: true,
    backgroundColor: 0x1a1a1a,
    ambientLightColor: 0x404040,
    directionalLightIntensity: 0.8
  }
);
```

## Configuration Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `showControls` | boolean | false | Show Tweakpane UI controls |
| `backgroundColor` | number | 0x000000 | Scene background color |
| `ambientLightColor` | number | 0x404040 | Ambient light color |
| `directionalLightIntensity` | number | 0.5 | Directional light intensity |
| `preset` | string | `default` | Style preset: `presentation`, `paper-light`, `talk-dark`, `clinical-qc`, `retinotopy`, or `glass-brain-surface` |
| `cameraPosition` | [x, y, z] | [0, 0, 200] | Initial camera position |
| `rotationSpeed` | number | 2.0 | Mouse rotation sensitivity |

## Methods

### Surface Management

```javascript
// Add a surface
viewer.addSurface(surface, 'brain');

// Remove a surface
viewer.removeSurface(surface);

// Get a surface by ID
const surface = viewer.getSurface('brain');
```

### Camera Controls

```javascript
// Center camera on all surfaces
viewer.centerCamera();

// Set a specific viewpoint
viewer.setViewpoint('lateral');  // lateral, medial, dorsal, ventral, anterior, posterior

// Get current camera position
const pos = viewer.getCameraPosition();
```

### Rendering

```javascript
// Start automatic render loop
viewer.startRenderLoop();

// Stop render loop
viewer.stopRenderLoop();

// Request a single render
viewer.requestRender();

// Force immediate render
viewer.render();
```

### Resize

```javascript
window.addEventListener('resize', () => {
  viewer.resize(window.innerWidth, window.innerHeight);
});
```

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
  title: 'Subject 01 activation'
});
```

`exportScene()` captures the current serialized viewer state plus provenance, asset references, software version, and optional `SubjectPackage` metadata. `exportStaticHTML()` embeds that scene manifest in a standalone HTML shell for sharing or later hydration.

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

Style presets control the viewer background, lighting, material defaults, curvature display parameters, annotation defaults, ROI/export label styling, colormap defaults, export dimensions, and font scale. `exportPNG()` renders at the requested pixel size and returns a PNG data URL; `dpi` is retained as figure intent because browser PNG encoders do not reliably write DPI metadata.

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

```javascript
// Dispose of all resources
viewer.dispose();
```

## Picking and Interaction

```javascript
// Pick at screen coordinates
const hit = viewer.pick({ x: event.clientX, y: event.clientY });

if (hit.surfaceId && hit.vertexIndex !== null) {
  console.log(`Hit surface ${hit.surfaceId} at vertex ${hit.vertexIndex}`);
}
```

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
