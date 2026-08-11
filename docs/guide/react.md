# React Integration

SurfView.js provides React components and hooks for seamless integration with React applications.

## Installation

```bash
npm install surfview three react react-dom
```

## Basic Usage

```jsx
import React, { useRef, useEffect } from 'react';
import { NeuroSurfaceViewerReact, useNeuroSurface } from 'surfview/react';

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
    <NeuroSurfaceViewerReact
      ref={viewerRef}
      width={800}
      height={600}
      config={{
        backgroundColor: 0x1a1a1a
      }}
    />
  );
}
```

## First-Party Scientific Controls

The optional panel is a separate React entry over the same custom element used
by non-React applications. Keep the viewer instance in state and pass it to the
panel when `onReady` fires:

```tsx
import { useState } from 'react';
import type { NeuroSurfaceViewer } from 'surfview';
import { NeuroSurfaceViewerReact } from 'surfview/react';
import { SurfViewControls } from 'surfview/controls/react';

export function BrainWorkspace() {
  const [viewer, setViewer] = useState<NeuroSurfaceViewer | null>(null);

  return (
    <main className="brain-workspace">
      <NeuroSurfaceViewerReact
        width={900}
        height={700}
        onReady={setViewer}
      />
      <aside aria-label="Surface settings">
        <SurfViewControls
          viewer={viewer}
          label="Cortical surface controls"
          theme="auto"
          density="compact"
          features={{
            include: ['view', 'layers', 'layer-inspector', 'selection', 'figure']
          }}
        />
      </aside>
    </main>
  );
}
```

`viewer={null}` renders an empty host and mounts nothing. The wrapper disposes
the panel on unmount, viewer replacement, and viewer disposal; React StrictMode
does not leave duplicate subscriptions or custom elements. Pass `container`
when an existing application-owned element should host the panel. In that
form, `SurfViewControls` renders no additional wrapper.

Changes to `label`, `theme`, `density`, and `features` update the mounted panel.
Changes to `viewer`, `container`, `target`, `session`, or `pluginId` replace only
the panel mount, never the viewer. Memoize `target` and `session` option objects
when supplying them. See [First-party controls](./controls.md) for feature and
lifecycle details.

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
<NeuroSurfaceViewerReact
  ref={viewerRef}
  width={window.innerWidth}
  height={window.innerHeight}
  config={{
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
  () => import('surfview/react').then(m => m.default),
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
import { NeuroSurfaceViewerReact } from 'surfview/react';
import type { ViewerConfig, SurfaceClickEvent } from 'surfview';

const config: ViewerConfig = {
  backgroundColor: 0x1a1a1a
};

const handleClick = (event: SurfaceClickEvent) => {
  console.log(event.surfaceId, event.vertexIndex);
};
```

## Full Example

```jsx
import React, { useRef, useEffect, useState } from 'react';
import { NeuroSurfaceViewerReact, useNeuroSurface } from 'surfview/react';
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
<NeuroSurfaceViewerReact
  ref={viewerRef}
  width={800}
  height={600}
  config={{ preset: 'paper-light' }}
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
