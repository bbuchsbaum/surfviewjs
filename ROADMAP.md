# SurfView.js Feature Roadmap

Features inspired by pycortex shader library, adapted for surface-only visualization.

## Priority 1: Curvature Underlay

**Goal**: Display mesh curvature as a grayscale underlay beneath data layers.

**Why**: Provides anatomical context (sulci/gyri visibility) that's standard in neuroimaging viewers.

### Background: What is Curvature?

Curvature is a **purely geometric property** of the mesh - it measures how much the surface bends at each vertex:
- **Sulci** (folds): negative curvature (concave)
- **Gyri** (crowns): positive curvature (convex)
- **Flat regions**: zero curvature

**Key insight**: Curvature is typically computed on the **folded (pial) surface** and then stored as a per-vertex attribute. This allows it to be displayed even on inflated or flat surface representations - showing "where the folds were" for anatomical reference.

### Data Sources

Curvature data can come from:

1. **Pre-computed files** (most common)
   - FreeSurfer: `lh.curv`, `rh.curv` (binary format)
   - GIFTI: `*.curv.gii` or as a DataArray in surface file
   - Plain arrays: Float32Array from any source

2. **Computed from mesh geometry**
   - Useful for non-brain meshes or when files unavailable
   - Mean curvature via discrete Laplacian or angle deficit
   - Note: On already-inflated surfaces, computed curvature will be near-zero (not useful)

### Implementation Plan

1. **Curvature File Loading** (`src/loaders/curvature.ts`)
   - [ ] `loadFreeSurferCurvature(url): Promise<Float32Array>` - parse FreeSurfer binary format
   - [ ] `loadGIFTICurvature(url): Promise<Float32Array>` - extract from GIFTI file
   - [ ] Auto-detect format from file extension

2. **Curvature Computation** (`src/utils/curvature.ts`) ✅ DONE
   - [x] `computeMeanCurvature(geometry: SurfaceGeometry): Float32Array`
   - [x] Algorithm: discrete Laplace-Beltrami operator (umbrella operator approximation)
   - [x] `normalizeCurvature()` for percentile-based normalization
   - [x] `curvatureToGrayscale()` for display conversion
   - Note: Only meaningful on folded surfaces, not inflated/flat

3. **CurvatureLayer** (`src/layers/CurvatureLayer.ts`) ✅ DONE
   - [x] New layer type extending Layer
   - [x] Properties: `brightness`, `contrast`, `smoothness`
   - [x] Converts curvature values to grayscale RGBA:
     ```
     gray = clamp(curvature / smoothness, -0.5, 0.5) * contrast + brightness
     ```
   - [x] Renders below base layer (order: -2)

4. **Integration** ✅ DONE
   - [x] `MultiLayerNeuroSurface` config options:
     - `curvature?: Float32Array` - pre-loaded curvature data
     - `showCurvature?: boolean` - display as underlay (default: true if curvature provided)
     - `curvatureOptions?: { brightness, contrast, smoothness }`
   - [x] Convenience methods: `setCurvature()`, `getCurvatureLayer()`, `showCurvature()`
   - [x] Demo scenario with slider controls for brightness/contrast/smoothness

5. **Tests**
   - [ ] Unit test: FreeSurfer curvature file parsing
   - [ ] Unit test: curvature computation on icosahedron (known values)
   - [ ] Unit test: CurvatureLayer RGBA output
   - [x] Demo scenario: load brain + curvature, overlay data

### Breaking Change Risk: LOW
- New files only, no modifications to existing layer logic
- Optional feature, disabled by default

---

## Priority 2: Slice Plane Clipping ✅ DONE

**Goal**: Clip the rendered surface with arbitrary planes.

**Why**: Useful for revealing medial wall, focusing on regions, presentation figures.

### Implementation Plan

1. **ClipPlane Class** (`src/utils/ClipPlane.ts`) ✅ DONE
   - [x] Properties: `normal: Vector3`, `point: Vector3`, `enabled: boolean`
   - [x] Method: `setFromPoints(a, b, c)` for easy setup
   - [x] Method: `setFromAxisDistance(axis: 'x'|'y'|'z', distance: number)`
   - [x] Method: `setFromNormalAndPoint(normal, point)` for custom planes
   - [x] `ClipPlaneSet` class for managing X, Y, Z planes together

2. **Shader Modifications** ✅ DONE
   - [x] Add clip plane uniforms to GPU compositor
   - [x] Fragment shader: `if (dot(vWorldPosition - planePoint, planeNormal) > 0.0) discard;`
   - [x] Support up to 3 clip planes (X, Y, Z)

3. **CPU Material Support** ✅ DONE
   - [x] Use Three.js built-in `clippingPlanes` on MeshPhongMaterial
   - [x] Sync clip planes between CPU and GPU modes via `_syncClipPlanes()`
   - [x] Enable `renderer.localClippingEnabled` when clip planes active

4. **Surface Integration** ✅ DONE
   - [x] `surface.setClipPlane(axis, distance, enabled, flip)`
   - [x] `surface.enableClipPlane(axis)` / `disableClipPlane(axis)`
   - [x] `surface.clearClipPlanes()`
   - [x] `surface.getClipPlane(axis)` for direct access

5. **Tests** ✅ DONE
   - [x] Demo scenario: interactive clipping (`demo/scenarios/clipping.ts`)
   - [x] Preset buttons for midline, anterior clips
   - [x] Flip direction toggle for each axis
   - [ ] Unit test: clip plane works in both CPU and GPU modes (visual verification via demo)

### Breaking Change Risk: LOW
- Shader changes are additive (new uniforms, guarded by conditionals)
- New API methods, no changes to existing methods

---

## Priority 3: 2D Colormaps ✅ DONE

**Goal**: Map two scalar fields to X/Y coordinates of a 2D colormap texture.

**Why**: Visualize relationships between variables (e.g., effect size vs. confidence).

### Implementation Plan

1. **2D Colormap Textures** (`src/ColorMap2D.ts`) ✅ DONE
   - [x] Generate 2D colormap textures (256x256)
   - [x] Built-in presets: `hot_cold`, `rgba_wheel`, `confidence`, `diverging`, `magnitude_phase`
   - [x] Support custom generator functions
   - [x] HSV-to-RGB conversion for color wheel effects
   - [x] Three.js DataTexture integration for GPU use

2. **TwoDataLayer** (`src/layers.ts`) ✅ DONE
   - [x] New layer class extending Layer concept
   - [x] Two data arrays: `dataX`, `dataY`
   - [x] Two ranges: `rangeX`, `rangeY`
   - [x] Two thresholds: `thresholdX`, `thresholdY`
   - [x] `is2DLayer` flag for type detection
   - [x] `getRGBAData()` samples from 2D colormap

3. **Compositor Support** ✅ DONE
   - [x] TwoDataLayer.getRGBAData() handles 2D colormap sampling
   - [x] Works with existing GPU compositor (no shader changes needed)
   - [x] CPU and GPU modes both supported via Layer interface

4. **Integration** ✅ DONE
   - [x] `MultiLayerNeuroSurface.addTwoDataLayer()` convenience method
   - [x] `MultiLayerNeuroSurface.getTwoDataLayer()` type-safe getter
   - [x] Layer.fromConfig() supports `type: 'twodata'`
   - [x] Exported from index.js: `TwoDataLayer`, `ColorMap2D`

5. **Tests** ✅ DONE
   - [x] Demo scenario: effect size + confidence visualization
   - [x] Interactive preset switching
   - [x] Threshold controls for Y axis
   - [ ] Unit tests (visual verification via demo)

### Breaking Change Risk: LOW (achieved)
- New layer type, existing DataLayer unchanged
- No GPU compositor shader changes required
- Additive exports only

---

## Priority 4: Surface Morphing ✅ DONE

**Goal**: Smooth animated transitions between surface representations.

**Why**: Helps users understand correspondence between folded/inflated/flat views.

### Implementation Plan

1. **MorphableSurface Class** (`src/MorphableSurface.ts`) ✅ DONE
   - [x] New surface class extending MultiLayerNeuroSurface
   - [x] Uses Three.js morphTargets for GPU-accelerated morphing
   - [x] `addMorphTarget(name, positions, curvature?)` - add morph targets
   - [x] `MorphableSurface.fromSurfaceSet()` - create from SurfaceSet
   - [x] Supports arbitrary number of morph targets

2. **Morph Animation** ✅ DONE
   - [x] `surface.setMorphWeight(name, weight)` - direct weight control
   - [x] `surface.setMorphWeights(weights)` - set multiple weights
   - [x] `surface.morphTo(name, options)` - animate to target
   - [x] `surface.morphToBase(options)` - animate back to base
   - [x] `surface.morphToWeights(weights, options)` - animate to blend
   - [x] Easing functions: linear, easeIn, easeOut, easeInOut, cubic variants

3. **Shader Support** ✅ DONE (via Three.js)
   - [x] Three.js morphTargets handle GPU interpolation automatically
   - [x] Normals are interpolated by the GPU during morphing
   - [x] `material.morphTargets = true` and `material.morphNormals = true`

4. **Slider-Based Morphing** ✅ DONE
   - [x] `surface.setMorphValue(value)` - 0=base, 1=first, 2=second, etc.
   - [x] `surface.getMorphValue()` - get current position
   - [x] Sequential morphing through all targets with single slider

5. **Demo Scenario** ✅ DONE
   - [x] Interactive demo with bumpy sphere → inflated → flat → exaggerated
   - [x] Target buttons with animated transitions
   - [x] Morph slider for sequential control
   - [x] Individual weight sliders for blending
   - [x] Configurable duration and easing

### Breaking Change Risk: LOW (achieved)
- New MorphableSurface class, existing surfaces unchanged
- No modifications to base SurfaceGeometry class needed
- Uses Three.js built-in morphTarget system

---

## Priority 5: GPU-Based Picking ✅ DONE

**Goal**: Faster, more accurate picking using render-to-texture.

**Why**: Current raycasting can be slow for large meshes; GPU picking gives exact vertex.

### Implementation Plan

1. **GPUPicker Class** (`src/utils/GPUPicker.ts`) ✅ DONE
   - [x] Create GPUPicker class with 1x1 WebGLRenderTarget
   - [x] Uses camera view offset for efficient single-pixel picking
   - [x] Supports adding/removing surfaces dynamically
   - [x] Throttling support for performance

2. **Pick Shader** ✅ DONE
   - [x] Encode vertex index into RGB (24-bit = 16.7M vertices)
   - [x] Custom ShaderMaterial with vertexId attribute
   - [x] Handles no-hit detection with white background

3. **Pick Pass** ✅ DONE
   - [x] Render pick scene with ID-encoded materials
   - [x] Read single pixel at mouse position
   - [x] Decode RGB to vertex index
   - [x] Return world position and face index

4. **Integration** ✅ DONE
   - [x] `viewer.pick({ x, y, useGPU })` uses GPU when enabled
   - [x] Automatic fallback to raycasting if GPU picking disabled
   - [x] `enableGPUPicking()` / `disableGPUPicking()` methods
   - [x] `useGPUPicking` config option
   - [x] Auto-register surfaces on add, cleanup on remove

5. **Demo Scenario** ✅ DONE
   - [x] Interactive demo with high-res sphere (~32k vertices)
   - [x] Toggle between GPU and raycasting
   - [x] Real-time performance comparison (pick time display)
   - [x] Hover crosshair integration

### Breaking Change Risk: LOW (achieved)
- New GPUPicker utility class
- Optional feature via config
- Automatic fallback to existing raycasting

---

## Implementation Order

1. **Curvature Underlay** - Highest user value, lowest risk
2. **Slice Plane Clipping** - High presentation value, low risk
3. **2D Colormaps** - Unique capability, medium complexity
4. **Surface Morphing** - Nice-to-have, requires geometry changes
5. **GPU Picking** - Performance optimization, defer unless needed

## Testing Strategy

For each feature:
1. Write unit tests BEFORE implementation
2. Add demo scenario for visual verification
3. Run full test suite after implementation
4. Test both CPU and GPU compositing modes
5. Test with real brain data (GIFTI files)

## Versioning

- Priority 1-2: Minor version bump (2.2.0)
- Priority 3-4: Minor version bump (2.3.0)
- Priority 5: Patch if no API change (2.3.1)

Breaking changes require major version bump - avoid if possible.
