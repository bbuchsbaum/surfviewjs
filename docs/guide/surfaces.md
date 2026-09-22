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

### VolumeProjectedSurface (WebGL2)

Surface that samples a 3D volume texture in a custom shader material (no CPU projection). Use `projectionMode: 'vertex'` for fast interaction, `'fragment'` for per-pixel sampling, or `'ribbon'` to sample through cortical thickness between white and pial surfaces. This is a convenience option when you only need a single volume overlay; for a unified multi-layer workflow, prefer `MultiLayerNeuroSurface + VolumeProjectionLayer`.

```javascript
import { NeuroSurfaceViewer } from 'surfview';

// Returns null if WebGL2 3D textures (and float linear filtering) aren’t supported.
const surface = viewer.addVolumeProjectedSurface(
  geometry,
  'brain',
  {
    data: volumeData,
    dims: [nx, ny, nz],
    affineMatrix, // voxel->world (column-major) or provide worldToIJK
    projectionMode: 'ribbon',
    whitePositions,
    pialPositions,
    ribbonSamples: 7,
    ribbonReducer: 'mean'
  },
  {
    colormap: 'hot',
    range: [-3, 3],
    threshold: [-1.96, 1.96],
    opacity: 1.0
  }
);
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
  'unknown'   // hemisphere: left, right, both, or unknown
);

// Access properties
console.log(geometry.getVertexCount());
console.log(geometry.faces.length / 3);
console.log(geometry.vertices);
console.log(geometry.faces);
```

Construction is an invariant boundary. Coordinates must be finite and grouped
as XYZ triples; faces must be integer, nonnegative, in-range triangle indices;
and optional curvature must contain exactly one finite value per vertex.
Invalid input throws `SurfaceGeometryError` before integer coercion, adjacency
construction, or Three.js allocation.

## Loading Surfaces

### From GIFTI, FreeSurfer, and PLY files

```javascript
import { loadSurface, SurfaceLoadError } from 'surfview';

const controller = new AbortController();
try {
  const geometry = await loadSurface(
    '/subjects/S01/lh.pial.gii?download=1',
    'auto',
    'unknown',
    30_000,
    false,
    100,
    { signal: controller.signal }
  );
} catch (error) {
  if (error instanceof SurfaceLoadError) {
    console.error(error.code, error.stage, error.format);
  }
}
```

Auto-detection is case-insensitive and examines the URL pathname, so query
strings and fragments do not hide `.gii`, `.ply`, or conventional FreeSurfer
surface names. Supported payloads are GIFTI ASCII, Base64, gzip-Base64, and the
documented zlib-framed compatibility variant; FreeSurfer big-endian triangle
surfaces and new-style curvature; and PLY `ascii 1.0` with leading scalar
`x`, `y`, `z` properties and triangular `vertex_indices`. Unsupported PLY
binary or GIFTI external-file encodings fail explicitly.

Laterality precedence is explicit argument, GIFTI
`AnatomicalStructurePrimary`, then an unambiguous basename token (`lh`/`left`,
`rh`/`right`, or fsLR `L`/`R`). Otherwise it remains `unknown`; SurfView never
silently changes unknown to left.

The timeout and optional caller signal remain active through response-body
consumption, decompression, parsing, validation, and construction. Timers and
abort listeners are always released. In Node/SSR, pass a DOM parser explicitly:

```javascript
import { JSDOM } from 'jsdom';
import { loadSurface } from 'surfview';

const { DOMParser } = new JSDOM().window;
const geometry = await loadSurface(
  'brain.surf.gii', 'gifti', 'unknown', 30_000, false, 100,
  { domParser: DOMParser }
);
```

The default and hard maximum body limit is 500 MiB; pass a smaller positive
integer as `options.maxBytes` when the application knows its expected asset
size. Geometry is additionally bounded at 10,000,000 vertices and 20,000,000
faces. Header counts, decoded dimensions, byte lengths, finite coordinates,
triangle grouping, integer indices, index bounds, and optional curvature length
are validated before the promise returns.

All load failures are `SurfaceLoadError` values with a stable `code`, the
failing `stage` (`detect`, `fetch`, `body`, `parse`, or `validate`), and the
detected `format` when known. `loadSurface()` creates no viewer state, so a
rejection cannot leave a half-registered surface; construct and add the surface
only after successful resolution.

### From Custom Data

```javascript
const geometry = new SurfaceGeometry(
  new Float32Array([/* x,y,z, x,y,z, ... */]),
  new Uint32Array([/* v0,v1,v2, v0,v1,v2, ... */]),
  'unknown'
);
```

## Linked Flatmaps

`FlatMapView` renders a 2D embedding that shares vertex ids with a 3D surface. `LinkedBrainWorkspace` keeps hover, selection, layer state, and optional timeline state synchronized between the flatmap and `NeuroSurfaceViewer`.

```javascript
import { FlatMapView, LinkedBrainWorkspace } from 'surfview';

const flatmap = new FlatMapView(flatContainer, {
  surfaceId: 'lh',
  vertices: flatPositions,
  faces
});

const workspace = new LinkedBrainWorkspace({
  viewer,
  flatmap,
  surfaceId: 'lh'
});

flatmap.on('selection:changed', ({ vertexIndex }) => {
  console.log('Flatmap selected vertex:', vertexIndex);
});
```

The 3D and flat positions must have the same vertex order. The flatmap uses the x/y coordinates from `vertices` and ignores z.
Flatmap width and height are positive integer canvas pixels; padding is finite,
nonnegative, and must leave a positive drawing area. Programmatic hover and
selection indices must name an existing vertex, and timeline values and screen
coordinates must be finite. Rejected updates leave canvas size, selection,
time, rendering, and events unchanged.

Flatmaps can also create vertex-space ROIs without leaving the browser:

```javascript
flatmap.startROIDrawing({
  mode: 'polygon', // or 'lasso'
  name: 'V1_candidate',
  color: '#ffd166',
  provenance: { sourceLayer: 'retinotopy.angle' }
});

flatmap.on('roi:created', ({ roi }) => {
  console.log(roi.vertexIndices);
});
```

For scripted workflows, create an ROI from a polygon in canvas coordinates and export it as SVG or label data:

```javascript
import { roiToSVG, roiToLabelGIFTI } from 'surfview';

const roi = flatmap.createROIFromPolygon(polygon, {
  name: 'V1_candidate',
  provenance: { sourceLayer: 'activation' }
});

const svg = roiToSVG(roi, { width: flatmap.canvas.width, height: flatmap.canvas.height });
const labelGii = roiToLabelGIFTI(roi, { vertexCount });
```

Morph targets use the same vertex layout as the base surface. Positions and
optional curvature values must be finite and have exact matching lengths.
Morph weights are finite (values outside `[0, 1]` remain available for deliberate
exaggeration), animation durations are finite and nonnegative, and invalid
replacement targets do not remove the currently registered target.
Optional surface configuration is omission-based. In TypeScript, explicit
`undefined` is rejected; JavaScript inputs containing it are treated as omitted
and cannot erase the normalized runtime defaults.

## Material Options

All surface types support material configuration:

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `materialType` | string | 'phong' | 'phong', 'standard', or 'physical' |
| `color` / `baseColor` | number | 0xa9a9a9 | Base surface color |
| `opacity` / `alpha` | number | 1 | Finite surface opacity in `[0, 1]` |
| `metalness` | number | 0 | Finite PBR metalness in `[0, 1]` |
| `roughness` | number | 0.5 | Finite PBR roughness in `[0, 1]` |
| `shininess` | number | 30 | Finite Phong shininess in `[0, 200]` |
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

Surface configuration is normalized into a truthful runtime type with concrete
defaults; only `smoothingAngle` remains optional. Constructor and
`updateConfig()` use the same validation. Invalid alpha, material coefficients,
angle, range, or threshold values are rejected before configuration, material,
or events change. Range and threshold pairs must be finite and ascending.
