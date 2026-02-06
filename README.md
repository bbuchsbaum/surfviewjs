# SurfView.js

A modular Three.js-based brain surface visualization library for neuroimaging applications.

**[Live Demo](https://bbuchsbaum.github.io/surfviewjs/demo/)** | **[Documentation](https://bbuchsbaum.github.io/surfviewjs/)**

## Features

- High-performance 3D brain surface rendering
- Multiple layer support with blending modes
- GPU volume-to-surface projection (WebGL2) via `VolumeProjectionLayer`
- Customizable colormaps for data visualization
- React component support
- Temporal playback with frame interpolation and sparkline tooltips
- Interactive controls with Tweakpane UI
- Support for GIFTI format
- TypeScript support

## Installation

Install the library with its peer dependencies (Three.js + Tweakpane). React bindings need React 18+.

```bash
npm install surfview three tweakpane
# React apps
npm install react react-dom
# Optional Tweakpane extras
npm install @tweakpane/plugin-essentials
```

## Quick Start

### Basic Usage (Vanilla JS)
```javascript
import { NeuroSurfaceViewer, SurfaceGeometry, ColorMappedNeuroSurface } from 'surfview';

const container = document.getElementById('viewer-container');
const viewer = new NeuroSurfaceViewer(container, 800, 600, { showControls: true });

// Typed arrays for vertices (xyz) and faces (triangle indices)
const geometry = new SurfaceGeometry(
  myVerticesFloat32Array,
  myFacesUint32Array,
  'left' // hemisphere tag
);

const surface = new ColorMappedNeuroSurface(
  geometry,
  null,
  myActivationDataFloat32Array,
  'viridis'
);

viewer.addSurface(surface, 'brain');
viewer.startRenderLoop();
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
import NeuroSurfaceViewerReact, { useNeuroSurface } from 'surfview/react';

function BrainViewer() {
  const viewerRef = useRef();
  const { addSurface } = useNeuroSurface(viewerRef);

  const handleReady = () => {
    addSurface({
      type: 'multi-layer',
      vertices: vertexData,
      faces: faceData,
      hemisphere: 'left',
      config: { baseColor: 0xdddddd }
    });
  };

  return (
    <NeuroSurfaceViewerReact
      ref={viewerRef}
      width={window.innerWidth}
      height={window.innerHeight}
      config={{
        showControls: true,
        ambientLightColor: 0x404040
      }}
      viewpoint="lateral"
      onReady={handleReady}
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
- **VolumeProjectionLayer**: Sample a 3D volume texture at each vertex (GPU compositing)
- **TemporalDataLayer**: Time-varying scalar data with frame interpolation
- **OutlineLayer**: ROI boundary outlines
- **LabelLayer**: Discrete region labels

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

```javascript
// GPU volume-to-surface overlay (WebGL2 + GPU compositing)
import { VolumeProjectionLayer } from 'surfview';

surface.setCompositingMode(true);
surface.addLayer(new VolumeProjectionLayer('volume', volumeData, [nx, ny, nz], {
  affineMatrix,           // voxel->world (column-major)
  colormap: 'hot',
  range: [-3, 3],
  threshold: [-1.96, 1.96],
  opacity: 0.85
}));
surface.updateColors();
```

#### Layer management quick hits
- Add: `surface.addLayer(layer)` where `layer` is `BaseLayer`, `DataLayer`, `RGBALayer`, `VolumeProjectionLayer`, `OutlineLayer`, or `LabelLayer`.
- Update: `surface.updateLayer(id, updates)` for single-layer tweaks or `surface.updateLayers([{ id, ...updates }])` for batches (no `type` required when updating).
- Order: `surface.setLayerOrder(['base', 'activation', 'roi'])`.
- Clear: `surface.clearLayers()` removes all non-base layers; pass `{ includeBase: true }` to drop the base too.
- CPU vs GPU compositing: pass `useGPUCompositing: true` in `MultiLayerNeuroSurface` config to enable WebGL2-based blending; call `surface.setWideLines(false)` if your platform dislikes wide-line outlines.

## Temporal Playback

Animate time-series data on a brain surface with smooth frame interpolation, playback controls, and hover sparkline tooltips.

```javascript
import {
  MultiLayerNeuroSurface, TemporalDataLayer,
  TimelineController, SparklineOverlay
} from 'surfview';

// frames: array of Float32Arrays (one per timepoint, each of length vertexCount)
// times: sorted array of time values (same length as frames)
const temporalLayer = new TemporalDataLayer('activation', frames, times, 'hot', {
  range: [0, 1],
  threshold: [0.15, 0],
  opacity: 0.85
});

surface.addLayer(temporalLayer);

// Timeline controller drives playback (decoupled from rendering)
const timeline = new TimelineController(times, { speed: 0.5, loop: 'loop' });

timeline.on('timechange', (e) => {
  temporalLayer.setTime(e.frameA, e.frameB, e.alpha);
  surface.requestColorUpdate();
});

timeline.play();
```

### Sparkline Tooltips

Show a per-vertex time-series sparkline on hover with a playback position marker:

```javascript
const sparkline = new SparklineOverlay(container, {
  width: 220, height: 90,
  lineColor: '#ff8800', timeMarkerColor: '#ff2222'
});

viewer.on('vertex:hover', (e) => {
  if (e.vertexIndex !== null) {
    const series = temporalLayer.getTimeSeries(e.vertexIndex);
    sparkline.show(series, times, timeline.getState().currentTime, e.screenX, e.screenY);
  } else {
    sparkline.hide();
  }
});

timeline.on('timechange', (e) => sparkline.updateTimeMarker(e.time));
```

### TimelineController API

- `play()`, `pause()`, `stop()`, `toggle()` -- playback control
- `seek(time)` -- jump to a specific time
- `setSpeed(multiplier)` -- e.g. `0.5` for half speed, `2` for double
- `setLoop('none' | 'loop' | 'bounce')` -- loop mode
- `getState()` -- returns `{ currentTime, playing, speed, loopMode, frameA, frameB, alpha }`
- Events: `'timechange'`, `'play'`, `'pause'`, `'stop'`

## Available Colormaps

The library includes many standard scientific colormaps:
- Sequential: `viridis`, `plasma`, `inferno`, `magma`, `hot`, `cool`
- Diverging: `RdBu`, `bwr`, `coolwarm`, `seismic`, `Spectral`
- Qualitative: `jet`, `hsv`, `rainbow`
- Monochrome: `greys`, `blues`, `reds`, `greens`

## Loading Data

### GIFTI Format

```javascript
import { loadSurface, ColorMappedNeuroSurface } from 'surfview';

const geometry = await loadSurface('path/to/surface.gii', 'gifti', 'left');
const surface = new ColorMappedNeuroSurface(geometry, null, dataArray, 'coolwarm');
viewer.addSurface(surface, 'lh-brain');

// Node/SSR: loadSurface will auto-use jsdom if present; otherwise supply a DOMParser:
// const domParser = new (await import('jsdom')).JSDOM().window.DOMParser;
// const geometry = parseGIfTISurface(giftiXml, domParser);
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

#### Constructor
`new NeuroSurfaceViewer(container: HTMLElement, width: number, height: number, config?: ViewerConfig, viewpoint?: Viewpoint)`

#### Config Options
```typescript
interface ViewerConfig {
  showControls?: boolean;
  useControls?: boolean;       // leave false to tree-shake Tweakpane
  allowCDNFallback?: boolean;  // opt-in CDN fetch if tweakpane peer is missing
  backgroundColor?: number;
  ambientLightColor?: number;
  directionalLightColor?: number;
  directionalLightIntensity?: number;
  rotationSpeed?: number;
  initialZoom?: number;
  ssaoRadius?: number;
  ssaoKernelSize?: number;
  rimStrength?: number;
  metalness?: number;
  roughness?: number;
  useShaders?: boolean;
  controlType?: 'trackball' | 'surface';
  preset?: 'default' | 'presentation';
  linkHemispheres?: boolean;
  hoverCrosshair?: boolean;
  hoverCrosshairColor?: number;
  hoverCrosshairSize?: number;
  clickToAddAnnotation?: boolean;
}

type Viewpoint = 'lateral' | 'medial' | 'ventral' | 'posterior' | 'anterior' | 'unknown_lateral';
```

#### Methods
- `addSurface(surface, id?)`: Add a surface to the scene
- `removeSurface(id)`: Remove a surface
- `clearSurfaces()`: Remove all surfaces
- `centerCamera()`: Center camera on all surfaces
- `resetCamera()`: Reset camera distance/up
- `setViewpoint(viewpoint)`: Set camera viewpoint
- `startRenderLoop()`: Begin the animation/render loop
- `resize(width, height)`: Resize renderer + controls
- `toggleControls(show?)`: Show/hide Tweakpane UI
- `addLayer(surfaceId, layer)`, `updateLayer(surfaceId, layerId, updates)`, `removeLayer(surfaceId, layerId)`, `clearLayers(surfaceId, { includeBase? })`
- `pick({ x, y })`: Ray-pick a surface/vertex under screen coordinates
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
- Controls are opt-in: set `config.useControls = true`/`showControls = true` (and optionally `allowCDNFallback = true`) and install the `tweakpane` peer if you want the built-in UI.

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
- `surface:click` (pick result), `vertex:hover` (hover with surfaceId, vertexIndex, screenX, screenY)
- `render:before|render:after`, `render:needed`
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
