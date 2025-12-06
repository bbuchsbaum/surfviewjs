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
