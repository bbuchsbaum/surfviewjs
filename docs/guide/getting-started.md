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

## Optional React dependencies

```bash
npm install react react-dom
```

The first-party DOM controls are included in `surfview/controls`; they do not
require a separate package. React applications can use the thin
`surfview/controls/react` adapter after installing the React dependencies
above.

## Basic Setup

```javascript
import { NeuroSurfaceViewer, ColorMappedNeuroSurface } from 'surfview';

// Create a container element
const container = document.getElementById('viewer-container');

// Initialize the viewer
const viewer = new NeuroSurfaceViewer(container, 800, 600, {
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
- Add the optional [first-party scientific controls](/guide/controls)
- Try [temporal playback](/guide/temporal) for time-series animation
- Build an offline [portable report scene](/guide/portable-scenes)
- See [React integration](/guide/react) for React apps
