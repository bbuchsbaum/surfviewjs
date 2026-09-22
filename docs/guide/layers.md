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

### VolumeProjectionLayer (Volume Projection)

Sample a 3D volume at each surface vertex and map it through a 1D colormap.

- **Vertex GPU path**: when `MultiLayerNeuroSurface` is in GPU compositing mode and `projectionMode: 'vertex'`, sampling happens in the vertex shader (WebGL2 required).
- **Quality fallback**: `projectionMode: 'fragment'`, `'ribbon'`, or `'hybrid'` can be configured on the layer API; in the multi-layer compositor these modes render through the CPU RGBA texture path so publication-oriented settings stay available without changing the layer stack.
- **Ribbon sampling**: provide matching pial and white vertex positions to sample through cortical thickness with `mean`, `max`, `min`, or `median` reducers.

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
    fillValue: 0,

    projectionMode: 'ribbon', // 'vertex' | 'fragment' | 'ribbon' | 'hybrid'
    sampling: 'linear',       // 'nearest' | 'linear'
    quality: 'publication',   // 'interactive' | 'publication'
    ribbon: {
      white: whiteSurfaceVertices,
      pial: pialSurfaceVertices,
      samples: 7,
      reducer: 'mean'
    }
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
- `projectionMode: 'hybrid'` resolves to vertex sampling during interactive use and ribbon sampling in publication mode.
- For direct shader fragment/ribbon projection on one volume overlay, use `VolumeProjectedSurface`.
- GPU compositing currently supports up to 8 total layers (including the base layer); volume layers count toward this limit.

### TemporalDataLayer

For time-varying scalar data with frame interpolation. Extends `DataLayer` with multiple temporal frames. See the full [Temporal Playback](/guide/temporal) guide for details.

```javascript
import { TemporalDataLayer, TimelineController } from 'surfview';

// frames: T Float32Arrays (one per timepoint), each of length V
// times: sorted number[] of length T
const layer = new TemporalDataLayer('activation', frames, times, 'hot', {
  range: [0, 1],
  threshold: [0, 0.15],
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

## RGBA compositing contract

SurfView stores and exposes **straight-alpha** RGBA. A layer's RGBA buffer
contains intrinsic colormap or data coverage; `layer.opacity` scales source
alpha exactly once in the compositor. CPU and WebGL paths use the same
bottom-to-top algebra.

For destination color/alpha `Cb, Ab`, source `Cs, As`, and layer opacity `o`,
first set `as = As * o`. Normal and multiply use W3C separable blending followed
by Porter-Duff source-over:

```text
Ao = as + Ab * (1 - as)
normal premultiplied RGB = Cs * as + Cb * Ab * (1 - as)
multiply premultiplied RGB =
  Cb * Ab * (1 - as) + Cs * as * (1 - Ab) + (Cb * Cs) * Ab * as
straight output RGB = premultiplied RGB / Ao   (or zero when Ao is zero)
```

Additive mode is Porter-Duff plus-lighter: premultiplied source and destination
RGB and alpha are added, then clamped to one. This makes partial coverage and
partial opacity behave correctly instead of adding unweighted straight RGB.

The shader outputs straight alpha. Production materials use Three.js
`NormalBlending` with `premultipliedAlpha: false`, `depthTest: true`, and
`depthWrite: false`. Normal canvas blending converts the result to the
framebuffer's premultiplied representation over a transparent clear, or blends
it source-over the configured opaque clear color.

The automatic `BaseLayer` is an ordinary bottom layer. Hiding or removing every
layer produces a transparent surface; a visible opaque base produces alpha one.
Layer order therefore matters. GPU compositing supports eight visible layers;
excess layers produce a warning, and a viewer without WebGL2 explicitly keeps
the CPU compositor.

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

Numeric mutations are validation-first. Opacity is finite and in `[0, 1]`
(zero remains a valid fully transparent layer). Ranges and thresholds contain
exactly two finite ascending bounds; equal bounds are valid and disable the
threshold hide zone. Setters defensively copy pairs. A compound `update()` with
any invalid numeric field throws `NumericValidationError` before data, buffers,
revision counters, callbacks, or events change.

`StatisticalMapLayer` additionally requires p-values in `[0, 1]` with exactly
one value per data item and positive finite degrees of freedom. Updates are
checked against the candidate data length before any metadata or correction
mask changes. FDR/Bonferroni levels are in `(0, 1]`; cluster thresholds are
finite and nonnegative and minimum cluster sizes are positive integers.

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
// Read the exact bottom-to-top order used by CPU and GPU compositing.
const ordered = surface.getOrderedLayers();

// Set a complete legal order atomically.
const result = surface.setLayerOrder(['base', 'activation', 'roi', 'outline']);
if (!result.ok) {
  console.warn(result.code, result.message);
}

// Or move one reorderable layer to an exact stack index.
surface.moveLayer('roi', 1);
```

The stack owns runtime ordering. `LayerConfig.order` and `layer.order` are
deprecated initialization hints in SurfViewJS 2.x; changing `layer.order`
after insertion does not reorder the stack. Use `setLayerOrder()` or
`moveLayer()` instead.

Orders must contain every current layer exactly once. Base and curvature
layers are fixed anatomy underlays, while outline and connectivity layers are
fixed top overlays. Data layers can be reordered within the middle group.
Invalid commands return a typed failure and leave the existing order intact.

Use `surface.getLayerOrderDescriptors()` to inspect each layer's stable ID,
index, role, pinned position, and whether it is reorderable.

### Getting Layers

```javascript
// Get specific layer
const layer = surface.getLayer('activation');

// Get all layers
const allLayers = surface.getOrderedLayers();
```

### Presentation Metadata and Data Summaries

Layer metadata is optional. Layers without metadata use their stable ID as the
human-facing label.

```typescript
const layer = new DataLayer('activation', values, indices, 'RdBu', {
  presentation: {
    label: 'Task activation',
    description: 'Language minus control',
    units: 'z',
    missingValueLabel: 'Not estimated',
    provenance: { pipeline: 'fmriprep', contrast: 'language-control' }
  }
});

const presentation = layer.getPresentation();
layer.setPresentation({ label: 'Updated label', units: 'z' });
```

Presentation snapshots and their plain-object provenance are defensively
copied and frozen. Consumers should render all fields as text, never as trusted
HTML.

Scalar `DataLayer` instances provide compact summaries without exposing or
copying their complete vertex arrays:

```typescript
const summary = layer.getDataSummary();
// { finiteCount, missingCount, minimum, maximum }

const withHistogram = layer.getDataSummary({
  histogram: { bins: 32 }
});
// Adds { histogram: { edges, counts } }
```

Histograms are lazy and cached by data revision, surface-domain size, bin count,
and requested range. Visibility, opacity, colormap, display-range, threshold,
and presentation changes do not rebuild them. Sparse layers count unmapped
surface vertices as missing after they are attached to a surface.

Scalar layers also provide vertex-aware sampling without exposing their dense
arrays or private sparse index mapping:

```typescript
const value = layer.sampleValueAtVertex(vertexIndex);
```

Connectivity layers apply the same transactional numeric contract. Edge
indices are nonnegative integers, edge weights are finite, weight ranges are
finite ascending pairs, thresholds and `topN` are nonnegative (`topN` is an
integer), and tube/node radii are positive. Parcel-connectivity display and
alpha ranges are defensively copied; alpha endpoints stay in `[0, 1]`.
Compound updates validate all supplied numeric controls before replacing
edges, matrices, filters, buffers, or emitting change notifications.
Optional update fields follow omission semantics; use documented `null` values
for resets such as a parcel-connectivity threshold. Do not use explicit
`undefined` as a reset sentinel.

Dense layers index their value vector directly. Indexed sparse layers resolve
the surface vertex through a lazy lookup; if duplicate mappings exist, the
later mapping wins, matching rendering and summary semantics. The method
returns `null` for an invalid or unmapped vertex, a non-finite value, or a
disposed layer. It does not throw for these expected missing-data cases.

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
| `range` | [min, max] | [0, 1] | Finite ascending data range for colormap |
| `threshold` | [low, high] | [0, 0] | Finite ascending threshold range (transparent inside) |
| `colorMap` | string | 'viridis' | Colormap name |

## Blend Modes

- `normal` - Standard alpha blending
- `additive` - Add colors together
- `multiply` - Multiply colors

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
