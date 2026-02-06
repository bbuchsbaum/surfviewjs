# Layers

Layers allow you to overlay multiple data visualizations on the same surface. The layer system in `MultiLayerNeuroSurface` supports stacking, blending, and real-time updates.

## Layer Types

### DataLayer

For scalar data with colormap visualization.

```javascript
import { DataLayer } from 'surfview';

const layer = new DataLayer(
  'activation',           // unique ID
  data,                   // Float32Array (per-vertex values)
  null,                   // vertex mask (null = all vertices)
  'hot',                  // colormap name
  {
    range: [-5, 5],       // data range for colormap
    threshold: [-2, 2],   // values inside threshold are transparent
    opacity: 0.8,
    blendMode: 'normal'
  }
);

surface.addLayer(layer);
```

### VolumeProjectionLayer (GPU Volume Projection)

Sample a 3D volume at each surface vertex and map it through a 1D colormap.

- **GPU path**: when `MultiLayerNeuroSurface` is in GPU compositing mode, sampling happens in the vertex shader (WebGL2 required).
- **CPU fallback**: in CPU compositing mode, SurfView falls back to a per-vertex nearest-neighbor lookup + colormap on the CPU.

```javascript
import { MultiLayerNeuroSurface, VolumeProjectionLayer } from 'surfview';

const surface = new MultiLayerNeuroSurface(geometry, { useGPUCompositing: true });
viewer.addSurface(surface, 'brain');
surface.setCompositingMode(true); // stays CPU if WebGL2 is unavailable

const volumeLayer = new VolumeProjectionLayer(
  'volume',
  volumeData,          // Float32Array length = nx*ny*nz
  [nx, ny, nz],
  {
    // Provide ONE of:
    affineMatrix,      // voxel->world (column-major); inverted internally
    // worldToIJK,      // optional: direct world->voxel (column-major)
    // voxelSize, volumeOrigin, // optional: simple affine builder

    colormap: 'hot',
    range: [-3, 3],
    threshold: [-1.96, 1.96], // hide values inside [low, high]
    opacity: 0.85,
    fillValue: 0
  }
);

surface.addLayer(volumeLayer);
surface.updateColors();
```

**Updates**

```javascript
// Update display without reprojecting on the CPU
surface.updateLayer('volume', {
  colormap: 'viridis',
  range: [-5, 5],
  threshold: [-2.58, 2.58],
  opacity: 0.7
});

// 4D/timepoint update (uploads a new 3D texture on the GPU)
surface.updateLayer('volume', { volumeData: nextVolumeData });
```

**Notes**
- `affineMatrix` / `worldToIJK` arrays are interpreted as Three.js `Matrix4` layout (column-major).
- Values equal to `fillValue` (and out-of-bounds samples) are treated as transparent.
- GPU compositing currently supports up to 8 total layers (including the base layer); volume layers count toward this limit.

### TemporalDataLayer

For time-varying scalar data with frame interpolation. Extends `DataLayer` with multiple temporal frames. See the full [Temporal Playback](/guide/temporal) guide for details.

```javascript
import { TemporalDataLayer, TimelineController } from 'surfview';

// frames: T Float32Arrays (one per timepoint), each of length V
// times: sorted number[] of length T
const layer = new TemporalDataLayer('activation', frames, times, 'hot', {
  range: [0, 1],
  threshold: [0.15, 0],
  opacity: 0.85
});

surface.addLayer(layer);

// Drive with a TimelineController
const timeline = new TimelineController(times, { speed: 0.5, loop: 'loop' });
timeline.on('timechange', (e) => {
  layer.setTime(e.frameA, e.frameB, e.alpha);
  surface.requestColorUpdate();
});
timeline.play();
```

### RGBALayer

For pre-computed RGBA colors.

```javascript
import { RGBALayer } from 'surfview';

const colors = new Uint8Array(vertexCount * 4); // RGBA per vertex

const layer = new RGBALayer('custom-colors', colors, {
  opacity: 1,
  blendMode: 'normal'
});

surface.addLayer(layer);
```

### BaseLayer

The foundational layer (automatically created).

```javascript
// Base layer is created automatically with the surface
// Access it via:
const baseLayer = surface.getLayer('base');
```

### OutlineLayer

For edge highlighting.

```javascript
import { OutlineLayer } from 'surfview';

const layer = new OutlineLayer('outline', {
  color: 0x000000,
  width: 1,
  opacity: 1
});

surface.addLayer(layer);
```

## Layer Management

### Adding Layers

```javascript
surface.addLayer(layer);
```

### Updating Layers

```javascript
// Update single layer
surface.updateLayer('activation', {
  opacity: 0.5,
  range: [-10, 10]
});

// Batch update
surface.updateLayers([
  { id: 'activation', opacity: 0.8 },
  { id: 'roi', opacity: 1.0 }
]);
```

### Removing Layers

```javascript
// Remove specific layer
surface.removeLayer('activation');

// Clear all layers (except base)
surface.clearLayers();

// Clear all layers including base
surface.clearLayers({ includeBase: true });
```

### Layer Order

```javascript
// Set explicit order (bottom to top)
surface.setLayerOrder(['base', 'activation', 'roi', 'outline']);
```

### Getting Layers

```javascript
// Get specific layer
const layer = surface.getLayer('activation');

// Get all layers
const allLayers = surface.layerStack.getAllLayers();
```

## Layer Options

### Common Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `opacity` | number | 1 | Layer opacity (0-1) |
| `blendMode` | string | 'normal' | Blend mode |
| `visible` | boolean | true | Layer visibility |

### DataLayer Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `range` | [min, max] | auto | Data range for colormap |
| `threshold` | [low, high] | [0, 0] | Threshold range (transparent inside) |
| `colorMap` | string | 'viridis' | Colormap name |

## Blend Modes

- `normal` - Standard alpha blending
- `additive` - Add colors together
- `multiply` - Multiply colors
- `screen` - Screen blend mode

```javascript
const layer = new DataLayer('glow', data, null, 'hot', {
  blendMode: 'additive',
  opacity: 0.5
});
```

## Real-time Updates

```javascript
// Update data values
layer.setData(newData);

// Update range
layer.setRange([-10, 10]);

// Update threshold
layer.setThreshold([-1, 1]);

// Update colormap
layer.setColorMap('plasma');

// Apply changes to surface
surface.updateColors();
```

## GPU vs CPU Compositing

```javascript
// Enable GPU compositing for better performance with many layers
const surface = new MultiLayerNeuroSurface(geometry, {
  useGPUCompositing: true
});

// Toggle at runtime
surface.setCompositingMode(true);  // GPU
surface.setCompositingMode(false); // CPU
```
