---
layout: home
titleTemplate: Brain Surface Visualization for JavaScript

hero:
  name: SurfView.js
  text: Brain Surface Visualization
  tagline: GPU-accelerated cortical meshes, multi-layer data overlays, scientific colormaps, and temporal playback — powered by Three.js, in the browser.
  actions:
    - theme: brand
      text: Get Started
      link: /guide/getting-started
    - theme: alt
      text: Live Demo
      link: https://bbuchsbaum.github.io/surfviewjs/demo/
    - theme: alt
      text: API Reference
      link: /api/

features:
  - icon: 🧠
    title: Real cortical surfaces
    details: Load GIFTI, FreeSurfer, and PLY meshes — inflated, pial, or white — and render them with smooth, lit Three.js materials.
    link: /guide/surfaces
    linkText: Surfaces
  - icon: 🎨
    title: Multi-layer overlays
    details: Stack data, label, RGBA, and volume-projection layers with configurable blending, opacity, and GPU compositing.
    link: /guide/layers
    linkText: Layers
  - icon: 🌈
    title: Scientific colormaps
    details: Viridis, plasma, hot, cool, Spectral and more — with explicit threshold semantics and transparent-alpha masking.
    link: /guide/colormaps
    linkText: Colormaps
  - icon: ⏱️
    title: Temporal playback
    details: Animate time-series data with frame interpolation, playback controls, and hover sparkline tooltips.
    link: /guide/temporal
    linkText: Temporal
  - icon: ⚛️
    title: React ready
    details: First-class React components and hooks for dropping a viewer straight into a React app.
    link: /guide/react
    linkText: React integration
  - icon: ⚡
    title: Built for performance
    details: GPU layer compositing and picking, cached RGBA buffers, and O(V·degree) curvature keep large meshes interactive.
    link: /guide/performance
    linkText: Performance
---

## See it run

The surface below is a real `surfview` viewer rendering an actual fs_LR.32k inflated
cortex with a functional overlay — no screenshots, no video. Drag to orbit, scroll to zoom.

<SurfaceViewer :height="520" colormap="Spectral" caption="MultiLayerNeuroSurface — fs_LR.32k inflated left hemisphere with a Spectral data overlay." />

```ts
import { NeuroSurfaceViewer, MultiLayerNeuroSurface, DataLayer, loadSurface } from 'surfview'

// Create the viewer
const viewer = new NeuroSurfaceViewer(document.getElementById('viewer'), 800, 600)
viewer.startRenderLoop()

// Load a GIFTI surface and drape a data overlay on it
const geometry = await loadSurface('/fs_LR.32k.L.inflated.surf.gii', 'gifti', 'left')
const surface = new MultiLayerNeuroSurface(geometry, { useGPUCompositing: true })
viewer.addSurface(surface, 'cortex')
viewer.centerCamera()

viewer.addLayer('cortex', new DataLayer('overlay', metric, null, 'Spectral'))
```

::: tip Three.js peer dependency
SurfView.js renders with [Three.js](https://threejs.org). Install it alongside the
library (`npm install surfview three`). Generated reports can instead use the
self-contained [browser embed](/guide/portable-scenes), which includes Three.js.
:::
