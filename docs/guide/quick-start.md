# Quick Start

Get a brain surface rendering in under 5 minutes.

## Minimal Example

```html
<!DOCTYPE html>
<html>
<head>
  <title>SurfView.js Quick Start</title>
  <style>
    body { margin: 0; }
    #viewer { width: 100vw; height: 100vh; }
  </style>
</head>
<body>
  <div id="viewer"></div>

  <script type="module">
    import {
      NeuroSurfaceViewer,
      MultiLayerNeuroSurface,
      SurfaceGeometry,
      THREE
    } from 'surfview';

    // Create viewer
    const container = document.getElementById('viewer');
    const viewer = new NeuroSurfaceViewer(container,
      window.innerWidth,
      window.innerHeight,
      { showControls: false, useControls: false }
    );

    // Create a simple sphere as demo geometry
    const sphere = new THREE.SphereGeometry(50, 64, 64);
    const geometry = new SurfaceGeometry(
      new Float32Array(sphere.attributes.position.array),
      new Uint32Array(sphere.index.array),
      'demo'
    );

    // Create and add surface
    const surface = new MultiLayerNeuroSurface(geometry, {
      baseColor: 0x6699cc
    });

    viewer.addSurface(surface, 'demo');
    viewer.centerCamera();
    viewer.startRenderLoop();

    // Handle resize
    window.addEventListener('resize', () => {
      viewer.resize(window.innerWidth, window.innerHeight);
    });
  </script>
</body>
</html>
```

## With Data Overlay

Add activation data to your surface:

```javascript
import { DataLayer } from 'surfview';

// Generate sample data (one value per vertex)
const vertexCount = geometry.vertices.length / 3;
const data = new Float32Array(vertexCount);
for (let i = 0; i < vertexCount; i++) {
  data[i] = Math.sin(i * 0.1) * 5;
}

// Create a data layer with hot colormap
const layer = new DataLayer('activation', data, null, 'hot', {
  range: [-5, 5],
  opacity: 0.8
});

// Add layer to surface
surface.addLayer(layer);
```

## Loading Real Brain Data

```javascript
import { loadSurface } from 'surfview';

// Load GIFTI format surface
const geometry = await loadSurface('lh.pial.gii', 'gifti');
// Node/SSR: install jsdom or pass a DOMParser to parseGIfTISurface if no DOM is available.

const surface = new MultiLayerNeuroSurface(geometry, {
  baseColor: 0xdddddd,
  metalness: 0.2,
  roughness: 0.8
});

viewer.addSurface(surface, 'brain');
viewer.centerCamera();
```
