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
