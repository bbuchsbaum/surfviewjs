# Getting Started

SurfView.js is a modular Three.js-based brain surface visualization library for neuroimaging applications.

## Installation

::: code-group

```bash [npm]
npm install surfview
```

```bash [yarn]
yarn add surfview
```

```bash [pnpm]
pnpm add surfview
```

:::

## Peer Dependencies

SurfView.js requires Three.js as a peer dependency:

```bash
npm install three
```

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
  showControls: true,
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
