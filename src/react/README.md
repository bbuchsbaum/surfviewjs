# React Integration for NeuroSurfaceViewer

This directory contains React components and hooks for integrating the NeuroSurfaceViewer into React applications.

## Components

### `NeuroSurfaceViewerReact`

The main React component wrapper for the brain surface viewer.

```jsx
import { NeuroSurfaceViewerReact } from 'neurosurface';

function App() {
  const viewerRef = useRef();

  return (
    <NeuroSurfaceViewerReact
      ref={viewerRef}
      width={800}
      height={600}
      config={{
        showControls: false,
        ambientLightColor: 0x404040
      }}
      viewpoint="lateral"
      onReady={(viewer) => console.log('Ready!')}
      onError={(error) => console.error(error)}
    />
  );
}
```

#### Props

- `width` (number): Width of the viewer in pixels
- `height` (number): Height of the viewer in pixels
- `config` (object): Configuration options
  - `showControls` (boolean): Show/hide Tweakpane UI controls
  - `ambientLightColor` (number): Ambient light color (hex)
  - `directionalLightIntensity` (number): Directional light intensity
  - Other Three.js and rendering options
- `viewpoint` (string): Initial camera viewpoint ('lateral', 'medial', 'ventral', 'posterior')
- `onReady` (function): Callback when viewer is initialized
- `onError` (function): Error handler
- `onSurfaceClick` (function): Click handler for surface interactions (fires after a pick)
- `className` (string): CSS class name
- `style` (object): Inline styles
- Optional interaction config on `config`:
  - `hoverCrosshair`, `hoverCrosshairColor`, `hoverCrosshairSize`
  - `clickToAddAnnotation` (adds + activates an annotation on click)

#### Ref Methods

The component exposes methods through ref:

```jsx
const viewerRef = useRef();

// Access methods
viewerRef.current.addSurface(surface, 'surface-1');
viewerRef.current.addLayer('surface-1', layer);
viewerRef.current.updateLayer('surface-1', 'layer-1', { opacity: 0.5 });
viewerRef.current.setViewpoint('medial');
viewerRef.current.centerCamera();
viewerRef.current.toggleControls();
viewerRef.current.showCrosshair('surface-1', 123, { size: 2, color: 0xffcc00 });
viewerRef.current.addAnnotation('surface-1', 123, { note: 'my point' });
```

## Hooks

### `useNeuroSurface`

A React hook for managing surfaces and layers with state tracking.

```jsx
import { useNeuroSurface } from 'neurosurface';

function App() {
  const viewerRef = useRef();
  const {
    surfaces,
    addSurface,
    removeSurface,
    addLayer,
    updateLayer,
    removeLayer,
    updateLayersFromBackend,
    setLayerOrder
  } = useNeuroSurface(viewerRef);

  // Add a surface
  const surfaceId = addSurface({
    type: 'multi-layer',
    vertices: vertexData,
    faces: faceData,
    hemisphere: 'left'
  });

  // Add layers
  addLayer(surfaceId, {
    type: 'rgba',
    rgbaData: precomputedColors,
    config: { opacity: 0.8 }
  });

  // Update from backend
  updateLayersFromBackend(surfaceId, [
    { id: 'base', type: 'base', color: 0xcccccc },
    { id: 'activation', type: 'data', data: values, colorMap: 'jet' }
  ]);
}
```

## Helper Functions

### `SurfaceHelpers`

Utility functions for creating surfaces and layers:

```jsx
import { SurfaceHelpers } from 'neurosurface';

// Create geometry
const geometry = SurfaceHelpers.createGeometry(vertices, faces, 'left');

// Create surfaces
const multiLayerSurface = SurfaceHelpers.createMultiLayerSurface(geometry);
const colorMappedSurface = SurfaceHelpers.createColorMappedSurface(
  geometry, indices, data, 'jet'
);

// Create layers
const rgbaLayer = SurfaceHelpers.createRGBALayer('layer-1', rgbaData);
const dataLayer = SurfaceHelpers.createDataLayer('layer-2', data, indices, 'hot');
```

## Usage Examples

### Basic Setup

```jsx
import React, { useRef } from 'react';
import { NeuroSurfaceViewerReact, useNeuroSurface } from 'neurosurface';

function BrainViewer() {
  const viewerRef = useRef();
  const { addSurface, updateLayersFromBackend } = useNeuroSurface(viewerRef);

  const handleDataFromBackend = (data) => {
    // Add surface
    const surfaceId = addSurface({
      type: 'multi-layer',
      vertices: data.vertices,
      faces: data.faces,
      hemisphere: data.hemisphere
    });

    // Update layers
    updateLayersFromBackend(surfaceId, data.layers);
  };

  return (
    <NeuroSurfaceViewerReact
      ref={viewerRef}
      width={window.innerWidth}
      height={window.innerHeight}
      config={{ showControls: false }}
    />
  );
}
```

### Backend Integration Pattern

```jsx
// Backend sends layer updates
const backendData = {
  layers: [
    {
      id: 'anatomy',
      type: 'base',
      color: 0xcccccc
    },
    {
      id: 'activation-1',
      type: 'rgba',
      data: rgbaArray, // Pre-computed RGBA values
      opacity: 0.8,
      blendMode: 'normal'
    },
    {
      id: 'activation-2', 
      type: 'data',
      data: valueArray, // Raw values
      colorMap: 'jet',
      range: [0, 10],
      threshold: [2, 8],
      opacity: 0.7,
      blendMode: 'additive'
    }
  ]
};

// Apply to surface
updateLayersFromBackend(surfaceId, backendData.layers);
```

### Layer Control UI

```jsx
function LayerControls({ surfaceId, layers }) {
  const { updateLayer, removeLayer } = useNeuroSurface(viewerRef);

  return (
    <div>
      {Array.from(layers.values()).map(layer => (
        <div key={layer.id}>
          <label>
            Opacity:
            <input
              type="range"
              min="0"
              max="100"
              value={layer.opacity * 100}
              onChange={(e) => updateLayer(surfaceId, layer.id, {
                opacity: e.target.value / 100
              })}
            />
          </label>
          <button onClick={() => removeLayer(surfaceId, layer.id)}>
            Remove
          </button>
        </div>
      ))}
    </div>
  );
}
```

## TypeScript Support

TypeScript definitions are available when TypeScript support is added to the package. Until then, you can use JSDoc comments for type hints:

```jsx
/**
 * @param {import('neurosurface').SurfaceData} surfaceData
 * @returns {string} Surface ID
 */
function loadSurface(surfaceData) {
  return addSurface(surfaceData);
}
```
