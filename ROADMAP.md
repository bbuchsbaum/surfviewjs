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

2. **Curvature Computation** (`src/utils/curvature.ts`)
   - [ ] `computeMeanCurvature(geometry: SurfaceGeometry): Float32Array`
   - [ ] Algorithm: discrete Laplace-Beltrami operator
   - [ ] Cache results on SurfaceGeometry (compute once)
   - [ ] Note: Only meaningful on folded surfaces, not inflated/flat

3. **CurvatureLayer** (`src/layers/CurvatureLayer.ts`)
   - [ ] New layer type extending BaseLayer
   - [ ] Properties: `brightness`, `contrast`, `smoothness`
   - [ ] Converts curvature values to grayscale RGBA:
     ```
     gray = clamp(curvature / smoothness, -0.5, 0.5) * contrast + brightness
     ```
   - [ ] Always renders at bottom of layer stack (order: -1)

4. **Integration**
   - [ ] Add `curvature?: Float32Array` field to SurfaceGeometry
   - [ ] `MultiLayerNeuroSurface` config options:
     - `curvature?: Float32Array` - pre-loaded curvature data
     - `curvatureUrl?: string` - URL to load curvature from
     - `computeCurvature?: boolean` - compute from geometry (only useful for folded surfaces)
     - `showCurvature?: boolean` - display as underlay (default: true if curvature provided)
   - [ ] Add Tweakpane controls for brightness/contrast/smoothness

5. **Tests**
   - [ ] Unit test: FreeSurfer curvature file parsing
   - [ ] Unit test: curvature computation on icosahedron (known values)
   - [ ] Unit test: CurvatureLayer RGBA output
   - [ ] Demo scenario: load brain + curvature, overlay data

### Breaking Change Risk: LOW
- New files only, no modifications to existing layer logic
- Optional feature, disabled by default

---

## Priority 2: Slice Plane Clipping

**Goal**: Clip the rendered surface with arbitrary planes.

**Why**: Useful for revealing medial wall, focusing on regions, presentation figures.

### Implementation Plan

1. **ClipPlane Class** (`src/utils/ClipPlane.ts`)
   - [ ] Properties: `normal: Vector3`, `point: Vector3`, `enabled: boolean`
   - [ ] Method: `setFromPoints(a, b, c)` for easy setup
   - [ ] Method: `setFromAxisDistance(axis: 'x'|'y'|'z', distance: number)`

2. **Shader Modifications**
   - [ ] Add clip plane uniforms to GPU compositor
   - [ ] Fragment shader: `if (dot(vWorldPosition - planePoint, planeNormal) > 0.0) discard;`
   - [ ] Support up to 3 clip planes (X, Y, Z)

3. **CPU Material Support**
   - [ ] Use Three.js built-in `clippingPlanes` on MeshPhongMaterial
   - [ ] Sync clip planes between CPU and GPU modes

4. **Viewer Integration**
   - [ ] `viewer.setClipPlane(axis, distance, enabled)`
   - [ ] `viewer.clearClipPlanes()`
   - [ ] Tweakpane folder for interactive clip plane controls

5. **Tests**
   - [ ] Visual test: clip brain at midline (x=0)
   - [ ] Test: clip plane works in both CPU and GPU modes
   - [ ] Demo scenario: interactive clipping

### Breaking Change Risk: LOW
- Shader changes are additive (new uniforms, guarded by conditionals)
- New API methods, no changes to existing methods

---

## Priority 3: 2D Colormaps

**Goal**: Map two scalar fields to X/Y coordinates of a 2D colormap texture.

**Why**: Visualize relationships between variables (e.g., effect size vs. confidence).

### Implementation Plan

1. **2D Colormap Textures** (`src/colormaps/colormap2d.ts`)
   - [ ] Generate 2D colormap textures (e.g., 256x256)
   - [ ] Built-in options: `hot_cold`, `rgba_wheel`, `confidence_map`
   - [ ] Support custom 2D colormap images

2. **TwoDataLayer** (`src/layers/TwoDataLayer.ts`)
   - [ ] Extends DataLayer concept
   - [ ] Two data arrays: `dataX`, `dataY`
   - [ ] Two ranges: `rangeX`, `rangeY`
   - [ ] Two thresholds: `thresholdX`, `thresholdY`
   - [ ] Colormap is 2D texture, not 1D

3. **GPU Compositor Updates**
   - [ ] Detect 2D layer type
   - [ ] Sample 2D colormap: `texture2D(colormap2d, vec2(normX, normY))`

4. **CPU Compositor Updates**
   - [ ] TwoDataLayer.getRGBAData() samples from 2D colormap

5. **Tests**
   - [ ] Unit test: 2D colormap texture generation
   - [ ] Unit test: TwoDataLayer normalization
   - [ ] Demo scenario: activation + significance visualization

### Breaking Change Risk: MEDIUM
- New layer type, but existing DataLayer unchanged
- GPU compositor changes need careful testing
- May need colormap texture format changes

---

## Priority 4: Surface Morphing

**Goal**: Smooth animated transitions between surface representations.

**Why**: Helps users understand correspondence between folded/inflated/flat views.

### Implementation Plan

1. **Morph Targets**
   - [ ] Store multiple vertex position sets per surface
   - [ ] `geometry.addMorphTarget(name, vertices)`
   - [ ] Common targets: 'pial', 'inflated', 'flat', 'sphere'

2. **Morph Animation**
   - [ ] `surface.setMorphWeight(targetName, weight)` - 0 to 1
   - [ ] `surface.animateMorph(targetName, duration)` - tween to target
   - [ ] Use Three.js morphTargets or manual vertex interpolation

3. **Shader Support**
   - [ ] Pass morph weights as uniforms
   - [ ] Blend positions in vertex shader (already done by Three.js morphTargets)
   - [ ] Blend normals for correct lighting

4. **Viewer Integration**
   - [ ] `viewer.setMorph(weight)` - 0=folded, 1=inflated, 2=flat
   - [ ] Tweakpane slider for morph weight
   - [ ] Optional: play/pause morph animation

5. **Tests**
   - [ ] Test: morph between two known geometries
   - [ ] Test: normals update correctly during morph
   - [ ] Demo scenario: animated inflation

### Breaking Change Risk: MEDIUM
- Requires SurfaceGeometry changes (morph target storage)
- Shader changes for normal blending
- Existing surfaces work unchanged (no morph targets = no morphing)

---

## Priority 5: GPU-Based Picking

**Goal**: Faster, more accurate picking using render-to-texture.

**Why**: Current raycasting can be slow for large meshes; GPU picking gives exact vertex.

### Implementation Plan

1. **Pick Render Target**
   - [ ] Create separate WebGLRenderTarget for picking
   - [ ] Lower resolution acceptable (e.g., 512x512)

2. **Pick Shader**
   - [ ] Encode vertex index into RGBA (24-bit = 16M vertices)
   - [ ] Or encode barycentric + face index for sub-vertex precision

3. **Pick Pass**
   - [ ] Render scene with pick shader to pick target
   - [ ] Read pixel at mouse position
   - [ ] Decode to vertex/face index

4. **Integration**
   - [ ] `viewer.pick(screenX, screenY)` uses GPU method
   - [ ] Fallback to raycasting if WebGL read fails
   - [ ] Cache pick render (only re-render on geometry change)

5. **Tests**
   - [ ] Test: pick returns correct vertex on known geometry
   - [ ] Test: pick works at mesh edges
   - [ ] Benchmark: GPU pick vs raycast performance

### Breaking Change Risk: LOW
- Internal implementation change
- Same public API for picking
- Fallback maintains compatibility

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
