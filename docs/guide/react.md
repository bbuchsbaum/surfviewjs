# React Integration

SurfView.js provides React components and hooks for seamless integration with React applications.

## Installation

```bash
npm install surfview react react-dom
```

## Basic Usage

```jsx
import React, { useRef, useEffect } from 'react';
import { NeuroSurfaceViewer, useNeuroSurface } from 'surfview/react';

function BrainViewer() {
  const viewerRef = useRef();
  const { surfaces, addSurface, updateLayer } = useNeuroSurface(viewerRef);

  useEffect(() => {
    // Load surface on mount
    loadBrainSurface();
  }, []);

  const loadBrainSurface = async () => {
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
      width={800}
      height={600}
      config={{
        showControls: true,
        backgroundColor: 0x1a1a1a
      }}
    />
  );
}
```

## NeuroSurfaceViewer Component

### Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `width` | number | required | Viewer width in pixels |
| `height` | number | required | Viewer height in pixels |
| `config` | object | {} | Viewer configuration |
| `viewpoint` | string | 'lateral' | Initial camera viewpoint |
| `onReady` | function | - | Called when viewer is ready |
| `onSurfaceClick` | function | - | Called on surface click |

### Example with Full Props

```jsx
<NeuroSurfaceViewer
  ref={viewerRef}
  width={window.innerWidth}
  height={window.innerHeight}
  config={{
    showControls: true,
    backgroundColor: 0x1a1a1a,
    ambientLightColor: 0x404040,
    directionalLightIntensity: 0.8
  }}
  viewpoint="lateral"
  onReady={(viewer) => console.log('Viewer ready', viewer)}
  onSurfaceClick={(hit) => console.log('Clicked', hit)}
/>
```

## useNeuroSurface Hook

The `useNeuroSurface` hook provides methods for managing surfaces and layers.

```jsx
const {
  surfaces,        // Map of current surfaces
  addSurface,      // Add a new surface
  removeSurface,   // Remove a surface
  updateLayer,     // Update a layer
  addLayer,        // Add a layer to a surface
  removeLayer      // Remove a layer
} = useNeuroSurface(viewerRef);
```

### Adding Surfaces

```jsx
const surfaceId = addSurface({
  type: 'multi-layer',  // or 'color-mapped', 'vertex-colored'
  vertices: Float32Array,
  faces: Uint32Array,
  config: {
    baseColor: 0xcccccc,
    metalness: 0.3
  }
});
```

### Adding Layers

```jsx
addLayer(surfaceId, {
  id: 'activation',
  type: 'data',
  data: Float32Array,
  colorMap: 'hot',
  range: [-5, 5],
  opacity: 0.8
});
```

### Updating Layers

```jsx
updateLayer(surfaceId, 'activation', {
  opacity: 0.5,
  range: [-10, 10]
});
```

## SSR Considerations

For server-side rendering (Next.js, Remix), import dynamically:

```jsx
import dynamic from 'next/dynamic';

const BrainViewer = dynamic(
  () => import('surfview/react').then(m => m.NeuroSurfaceViewer),
  { ssr: false }
);
```

Or use the SSR helpers:

```jsx
import { hasDOM, NoopNeuroSurfaceViewer, NeuroSurfaceViewer } from 'surfview';

const Viewer = hasDOM() ? NeuroSurfaceViewer : NoopNeuroSurfaceViewer;
```

## TypeScript

Full TypeScript support is included:

```tsx
import { NeuroSurfaceViewer } from 'surfview/react';
import type { ViewerConfig, SurfaceClickEvent } from 'surfview';

const config: ViewerConfig = {
  showControls: true,
  backgroundColor: 0x1a1a1a
};

const handleClick = (event: SurfaceClickEvent) => {
  console.log(event.surfaceId, event.vertexIndex);
};
```

## Full Example

```jsx
import React, { useRef, useEffect, useState } from 'react';
import { NeuroSurfaceViewer, useNeuroSurface } from 'surfview/react';
import { loadSurface } from 'surfview';

function App() {
  const viewerRef = useRef();
  const { addSurface, addLayer, updateLayer } = useNeuroSurface(viewerRef);
  const [surfaceId, setSurfaceId] = useState(null);

  useEffect(() => {
    async function load() {
      const geometry = await loadSurface('/brain.surf.gii', 'gifti');

      const id = addSurface({
        type: 'multi-layer',
        vertices: geometry.vertices,
        faces: geometry.faces,
        config: { baseColor: 0xdddddd }
      });

      setSurfaceId(id);

      // Add activation layer
      addLayer(id, {
        id: 'activation',
        type: 'data',
        data: activationData,
        colorMap: 'hot',
        range: [-5, 5]
      });
    }

    load();
  }, []);

  const handleOpacityChange = (e) => {
    if (surfaceId) {
      updateLayer(surfaceId, 'activation', {
        opacity: parseFloat(e.target.value)
      });
    }
  };

  return (
    <div>
      <NeuroSurfaceViewer
        ref={viewerRef}
        width={800}
        height={600}
        config={{ showControls: true }}
      />
      <input
        type="range"
        min="0"
        max="1"
        step="0.1"
        onChange={handleOpacityChange}
      />
    </div>
  );
}
```
