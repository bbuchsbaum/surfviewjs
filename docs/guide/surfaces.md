# Surfaces

SurfView.js provides several surface types for different visualization needs.

## Surface Types

### MultiLayerNeuroSurface

The most flexible surface type, supporting multiple data layers with blending.

```javascript
import { MultiLayerNeuroSurface, SurfaceGeometry } from 'surfview';

const geometry = new SurfaceGeometry(vertices, indices, 'brain');

const surface = new MultiLayerNeuroSurface(geometry, {
  baseColor: 0xcccccc,
  metalness: 0.3,
  roughness: 0.7,
  useGPUCompositing: false
});
```

### ColorMappedNeuroSurface

Surface with a single data layer and colormap.

```javascript
import { ColorMappedNeuroSurface } from 'surfview';

const surface = new ColorMappedNeuroSurface(
  geometry,
  null,           // optional vertex mask
  dataArray,      // Float32Array of per-vertex values
  'viridis',      // colormap name
  {
    alpha: 1,
    materialType: 'phong'
  }
);
```

### VertexColoredNeuroSurface

Surface with pre-computed per-vertex colors.

```javascript
import { VertexColoredNeuroSurface } from 'surfview';

const colors = new Float32Array(vertexCount * 3); // RGB per vertex

const surface = new VertexColoredNeuroSurface(geometry, colors, {
  opacity: 1
});
```

### NeuroSurface

Basic surface with solid color.

```javascript
import { NeuroSurface } from 'surfview';

const surface = new NeuroSurface(geometry, {
  color: 0x6699cc,
  opacity: 1
});
```

## SurfaceGeometry

All surfaces require a `SurfaceGeometry` object:

```javascript
import { SurfaceGeometry } from 'surfview';

const geometry = new SurfaceGeometry(
  vertices,   // Float32Array - x,y,z coords (length = vertexCount * 3)
  indices,    // Uint32Array - triangle indices (length = faceCount * 3)
  'brain'     // optional name
);

// Access properties
console.log(geometry.vertexCount);
console.log(geometry.faceCount);
console.log(geometry.vertices);
console.log(geometry.faces);
```

## Loading Surfaces

### From GIFTI Files

```javascript
import { loadSurface } from 'surfview';

const geometry = await loadSurface('brain.surf.gii', 'gifti', 'left');
```

### From Custom Data

```javascript
const geometry = new SurfaceGeometry(
  new Float32Array([/* x,y,z, x,y,z, ... */]),
  new Uint32Array([/* v0,v1,v2, v0,v1,v2, ... */]),
  'custom'
);
```

## Material Options

All surface types support material configuration:

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `materialType` | string | 'phong' | 'phong', 'physical', 'basic' |
| `color` / `baseColor` | number | 0xffffff | Base surface color |
| `opacity` | number | 1 | Surface opacity (0-1) |
| `metalness` | number | 0 | PBR metalness (physical only) |
| `roughness` | number | 1 | PBR roughness (physical only) |
| `shininess` | number | 30 | Phong shininess |
| `flatShading` | boolean | false | Use flat shading |
| `wireframe` | boolean | false | Render as wireframe |

```javascript
const surface = new MultiLayerNeuroSurface(geometry, {
  materialType: 'physical',
  baseColor: 0xdddddd,
  metalness: 0.2,
  roughness: 0.6,
  flatShading: false
});
```

## Updating Surfaces

```javascript
// Update material properties
surface.updateConfig({
  metalness: 0.5,
  roughness: 0.3
});

// Update data (for ColorMappedNeuroSurface)
surface.setData(newDataArray);

// Update colormap
surface.setColorMap('plasma');
```
