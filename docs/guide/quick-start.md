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
      window.innerHeight
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

## Optional First-Party Controls

Mount the tailored SurfView control panel into an application-owned sidebar.
The optional `surfview/controls` entry is separate from the core renderer, and
mounting it does not rearrange the page or add anything to the Three.js scene.

```html
<div class="workspace">
  <div id="viewer"></div>
  <aside id="controls"></aside>
</div>

<script type="module">
  import { mountSurfViewControls } from 'surfview/controls';

  const controls = mountSurfViewControls(
    viewer,
    document.getElementById('controls'),
    {
      theme: 'auto',       // 'auto', 'light', or 'dark'
      density: 'compact'   // 'compact' or 'comfortable'
    }
  );

  // Later: idempotently removes the panel and all of its subscriptions.
  controls.dispose();
</script>
```

The permanent Figure section selects a style preset and viewer background.
Export dimensions, DPI, title, transparency, colorbar, and filename stay in
the keyboard-accessible **Export PNG** dialog so they do not consume sidebar
space. The panel inherits the host application's font. CSS custom properties
such as `--surfview-controls-focus` can override individual visual tokens.

See [First-party controls](./controls.md) for feature selection, direct
custom-element integration, React, report-target differences, lifecycle, and
the v0.1 certification contract.
