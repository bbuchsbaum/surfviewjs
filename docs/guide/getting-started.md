# Getting Started

SurfView.js is a modular Three.js-based brain surface visualization library for neuroimaging applications.

## Installation

::: code-group

```bash [npm]
npm install surfview three
```

```bash [yarn]
yarn add surfview three
```

```bash [pnpm]
pnpm add surfview three
```

:::

## Peer Dependencies

Optional peer dependencies for enhanced features:

```bash
# For Tweakpane UI controls
npm install tweakpane @tweakpane/plugin-essentials

# For React integration
npm install react react-dom
```

## Basic Setup

```javascript
import { NeuroSurfaceViewer, ColorMappedNeuroSurface } from 'surfview';

// Create a container element
const container = document.getElementById('viewer-container');

// Initialize the viewer
const viewer = new NeuroSurfaceViewer(container, 800, 600, {
  showControls: false,
  useControls: false, // set true + install tweakpane to enable built-in UI
  backgroundColor: 0x1a1a1a
});

// Start the render loop
viewer.startRenderLoop();
```

## Loading a Surface

```javascript
import { loadSurface, MultiLayerNeuroSurface } from 'surfview';

// Load a GIFTI surface file
const geometry = await loadSurface('brain.surf.gii', 'gifti');
// Node/SSR: install jsdom or pass a DOMParser to parseGIfTISurface if no DOM is available.

// Create a surface with the geometry
const surface = new MultiLayerNeuroSurface(geometry, {
  baseColor: 0xcccccc
});

// Add to viewer
viewer.addSurface(surface, 'brain');
viewer.centerCamera();
```

## Next Steps

- Learn about [surface types](/guide/surfaces)
- Explore [layer system](/guide/layers) for data visualization
- Check out [colormaps](/guide/colormaps) for data mapping
- See [React integration](/guide/react) for React apps
