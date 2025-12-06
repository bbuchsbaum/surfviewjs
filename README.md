# SurfView.js

A modular Three.js-based brain surface visualization library for neuroimaging applications.

## Features

- High-performance 3D brain surface rendering
- Multiple layer support with blending modes
- Customizable colormaps for data visualization
- React component support
- Interactive controls with Tweakpane UI
- Support for GIFTI format
- TypeScript support

## Installation

```bash
npm install surfview
```

Or with yarn:

```bash
yarn add surfview
```

## Quick Start

### Basic Usage (Vanilla JS)
```javascript
import { NeuroSurfaceViewer, ColorMappedNeuroSurface } from 'surfview';

const container = document.getElementById('viewer-container');
const viewer = new NeuroSurfaceViewer(container, 800, 600, { showControls: true });

// Minimal typed geometry (BufferGeometry also works)
const geometry = {
  vertices: myVerticesFloat32Array,
  indices: myFacesUint32Array,
  normals: myNormalsFloat32Array
};

const surface = new ColorMappedNeuroSurface(geometry, null, myData, 'viridis');
viewer.addSurface(surface, 'brain');
```

## Demo Hub

Run a unified, menu-driven set of visual checks:

```bash
npm run demo
```

This starts a Vite-powered demo app under `demo/` with scenarios for quick-start rendering, multi-layer compositing, lighting/material tuning, hemisphere layouts, and file loading (using fixtures in `tests/data`). Use it for quick sanity passes before releases.

### React Usage

```jsx
import React, { useRef } from 'react';
import { NeuroSurfaceViewer, useNeuroSurface } from 'surfview/react';

function BrainViewer() {
  const viewerRef = useRef();
  const { surfaces, addSurface, updateLayer } = useNeuroSurface(viewerRef);

  const loadSurface = async () => {
    const surfaceId = addSurface({
      type: 'multi-layer',
      vertices: vertexData,
      faces: faceData,
      config: {
        baseColor: 0xdddddd
      }
    });
  };

  return (
    <NeuroSurfaceViewer
      ref={viewerRef}
      width={window.innerWidth}
      height={window.innerHeight}
      config={{
        showControls: true,
        ambientLightColor: 0x404040
      }}
      viewpoint="lateral"
    />
  );
}
```

## Core Components

### NeuroSurfaceViewer
The main viewer class that manages the Three.js scene, camera, and rendering.

### Surface Types

- **NeuroSurface**: Basic surface with solid color
- **ColorMappedNeuroSurface**: Surface with data-driven colormapping
- **VertexColoredNeuroSurface**: Surface with per-vertex colors
- **MultiLayerNeuroSurface**: Surface supporting multiple data layers

### Layer System

Layers allow you to overlay multiple data visualizations on the same surface:

- **BaseLayer**: The foundational surface layer
- **DataLayer**: Scalar data with colormap
- **RGBALayer**: Pre-computed RGBA colors per vertex

```javascript
// Add a data layer to existing surface
surface.addLayer(new DataLayer(
  'activation',
  activationData,
  {
    colorMap: 'hot',
    range: [-5, 5],
    opacity: 0.7,
    blendMode: 'additive'
  }
));
```

#### Layer management quick hits
- Add: `surface.addLayer(layer)` where `layer` is `BaseLayer`, `DataLayer`, `RGBALayer`, `OutlineLayer`, or `LabelLayer`.
- Update: `surface.updateLayer(id, updates)` for single-layer tweaks or `surface.updateLayers([{ id, ...updates }])` for batches (no `type` required when updating).
- Order: `surface.setLayerOrder(['base', 'activation', 'roi'])`.
- Clear: `surface.clearLayers()` removes all non-base layers; pass `{ includeBase: true }` to drop the base too.
- CPU vs GPU compositing: pass `useGPUCompositing: true` in `MultiLayerNeuroSurface` config to enable WebGL2-based blending; call `surface.setWideLines(false)` if your platform dislikes wide-line outlines.

## Available Colormaps

The library includes many standard scientific colormaps:
- Sequential: `viridis`, `plasma`, `inferno`, `magma`, `hot`, `cool`
- Diverging: `RdBu`, `bwr`, `coolwarm`, `seismic`, `Spectral`
- Qualitative: `jet`, `hsv`, `rainbow`
- Monochrome: `greys`, `blues`, `reds`, `greens`

## Loading Data

### GIFTI Format

```javascript
import { loadGiftiSurface } from 'surfview';

const surface = await loadGiftiSurface('path/to/surface.gii');
viewer.addSurface(surface);
```

### Custom Data Format

```javascript
const surfaceData = {
  vertices: Float32Array, // x,y,z coordinates
  faces: Uint32Array,     // triangle indices
  data: Float32Array      // optional per-vertex data
};
```

## API Reference

### NeuroSurfaceViewer

#### Constructor Options
```typescript
interface ViewerConfig {
  container?: HTMLElement;
  width?: number;
  height?: number;
  showControls?: boolean;
  backgroundColor?: number;
  ambientLightColor?: number;
  directionalLightIntensity?: number;
  cameraPosition?: [number, number, number];
  viewpoint?: 'lateral' | 'medial' | 'dorsal' | 'ventral' | 'anterior' | 'posterior';
}
```

#### Methods
- `addSurface(surface)`: Add a surface to the scene
- `removeSurface(surface)`: Remove a surface
- `centerCamera()`: Center camera on all surfaces
- `setViewpoint(viewpoint)`: Set camera viewpoint
- `toggleControls()`: Show/hide Tweakpane UI
- `render()`: Force render update
- `dispose()`: Clean up resources
- `showCrosshair(surfaceId, vertexIndex, { size?, color? })`: Draw a 3-axis crosshair on a vertex
- `hideCrosshair()`: Remove the crosshair
- `toggleCrosshair(surfaceId?, vertexIndex?, { size?, color? })`: Toggle the crosshair (reuses last target if omitted)
- `addAnnotation(surfaceId, vertexIndex, data?, options?)`: Add a small marker sphere
- `listAnnotations(surfaceId?)`, `moveAnnotation(id, vertexIndex)`, `removeAnnotations(surfaceId)`: Manage markers in bulk

Minimal pick-to-crosshair example:
```ts
const hit = viewer.pick({ x: event.clientX, y: event.clientY });
if (hit.surfaceId && hit.vertexIndex !== null) {
  viewer.showCrosshair(hit.surfaceId, hit.vertexIndex, { size: 2, color: 0xffcc00 });
}
```

### Interaction helpers
- Set `config.hoverCrosshair = true` to show a lightweight hover crosshair (throttled).
- Set `config.clickToAddAnnotation = true` to drop an annotation + activate it on click.
- `onSurfaceClick` is now fired from the core viewer after a successful pick.

### ColorMap

#### Creating Custom Colormaps
```javascript
import { ColorMap } from 'surfview';

const customColormap = new ColorMap([
  [0, 0, 1],    // blue
  [0, 1, 0],    // green  
  [1, 1, 0],    // yellow
  [1, 0, 0]     // red
], {
  range: [0, 100],
  threshold: [10, 90]
});
```

## Browser Support

- Chrome 90+
- Firefox 88+
- Safari 14+
- Edge 90+

Requires WebGL 2.0 support.

### Performance Cheatsheet

- Disable SSAO/shadows and tonemapping for maximum FPS (`useShaders=false`, shadows off by default in current build).
- Reduce render size on high-DPI displays (`renderer.setPixelRatio(1)` or pass a smaller width/height to `resize`).
- Prefer flat colors over PBR materials for large meshes.
- Keep GPU compositing off unless you really need multi-layer blending.

### Troubleshooting

- If you see “WebGL is not available”, confirm hardware acceleration is enabled and the browser supports WebGL 2.
- For SSR/Node environments, only construct `NeuroSurfaceViewer` in the browser (e.g., inside a `useEffect` in React).
- If you must import on the server, use the provided `NoopNeuroSurfaceViewer` and `hasDOM` helpers to avoid touching the DOM/GL.
  ```ts
  import { hasDOM, NoopNeuroSurfaceViewer, NeuroSurfaceViewer } from 'surfview';
  const Viewer = hasDOM() ? NeuroSurfaceViewer : NoopNeuroSurfaceViewer;
  const viewer = new Viewer(container, 800, 600);
  ```
- Next.js/Remix SSR guard for React:
  ```jsx
  import dynamic from 'next/dynamic';
  const SSRSafeViewer = dynamic(() => import('surfview/react').then(m => m.NeuroSurfaceViewerReact), { ssr: false });
  ```

### Events you can listen for
- `surface:added|surface:removed|surface:variant`
- `layer:added|layer:removed|layer:updated|layer:colormap|layer:intensity|layer:threshold|layer:opacity`
- `surface:click` (pick result), `render:before|render:after`, `render:needed`
- `annotation:added|annotation:moved|annotation:removed|annotation:reset|annotation:activated`
- `viewpoint:changed`, `controls:changed|controls:error`

Example:
```js
viewer.on('layer:intensity', ({ layerId, range }) => {
  console.log('Layer', layerId, 'intensity changed to', range);
});
```

## Development

```bash
# Install dependencies
npm install

# Development server
npm run dev

# Build library
npm run build

# Type checking
npm run type-check

# Playwright smoke (run after installing browsers with `npx playwright install chromium`)
npm run test:playwright
```

## License

MIT

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## Acknowledgments

Built with:
- [Three.js](https://threejs.org/) - 3D graphics library
- [Tweakpane](https://tweakpane.github.io/docs/) - GUI controls
- [colormap](https://github.com/bpostlethwaite/colormap) - Colormap generation
