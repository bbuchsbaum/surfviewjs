# SurfViewJS API Documentation

## Table of Contents
- [Overview](#overview)
- [Material Properties](#material-properties)
- [Scene Lighting](#scene-lighting)
- [Geometry Smoothing](#geometry-smoothing)
- [Complete Examples](#complete-examples)
- [UI Implementation Guide](#ui-implementation-guide)

## Overview

SurfViewJS provides comprehensive control over neuroimaging surface visualization through three main categories:

1. **Material Properties** - Control surface appearance (shininess, color, transparency)
2. **Scene Lighting** - Configure environment lighting (ambient, directional, point lights)
3. **Geometry Smoothing** - Modify surface geometry (shading style, Laplacian smoothing)

## Material Properties

Material properties control how the surface itself looks and responds to light. The library supports both classic Phong shading and modern PBR (Physically Based Rendering) materials.

### SurfaceConfig Interface

```typescript
interface SurfaceConfig {
  // Material type selection
  materialType?: 'phong' | 'standard' | 'physical';  // Default: 'phong'
  
  // Common properties
  color?: THREE.ColorRepresentation;     // Base surface color
  flatShading?: boolean;                 // Faceted vs smooth look
  smoothingAngle?: number;                // Edge threshold for smoothing (0-180°)
  emissive?: THREE.ColorRepresentation;  // Self-illumination color
  emissiveIntensity?: number;             // Glow strength (0-1)
  alpha?: number;                         // Opacity (0-1)
  
  // Phong material properties (when materialType = 'phong')
  shininess?: number;                     // Specular highlight size (0-200)
  specularColor?: number;                 // Color of reflections (hex)
  
  // PBR properties (when materialType = 'standard' or 'physical')
  metalness?: number;                     // How metallic (0-1)
  roughness?: number;                     // How rough (0-1)
  
  // Data mapping
  thresh?: [number, number];              // Value threshold range
  irange?: [number, number];              // Data range for mapping
}
```

### Material Types

#### Phong Material (Classic)
Traditional shading model with specular highlights:
- **Pros**: Fast rendering, familiar controls
- **Cons**: Less realistic, no energy conservation
- **Use when**: Performance is critical, stylized look desired

#### Standard Material (PBR)
Physically Based Rendering with metalness/roughness workflow:
- **Pros**: Realistic materials, intuitive parameters
- **Cons**: Slightly slower than Phong
- **Use when**: Realistic rendering needed

#### Physical Material (Advanced PBR)
Extended PBR with additional properties:
- **Pros**: Most realistic, supports clearcoat, sheen, etc.
- **Cons**: Slowest performance
- **Use when**: Maximum realism required

### Applying Material Properties

```javascript
// Classic Phong material
const phongSurface = new ColorMappedNeuroSurface(
  geometry, indices, data, 'viridis',
  {
    materialType: 'phong',
    shininess: 50,
    specularColor: 0x666666,
    emissive: 0x0a0a0a,
    emissiveIntensity: 0.1,
    alpha: 1.0
  }
);

// PBR Standard material
const pbrSurface = new ColorMappedNeuroSurface(
  geometry, indices, data, 'viridis',
  {
    materialType: 'standard',
    metalness: 0.3,
    roughness: 0.7,
    emissive: 0x0a0a0a,
    emissiveIntensity: 0.1,
    alpha: 1.0
  }
);

// Switch material types dynamically
surface.updateConfig({
  materialType: 'standard',
  metalness: 0.8,
  roughness: 0.2
});
```

### Material Presets

#### Phong Presets
| Preset | Configuration |
|--------|--------------|
| **Matte** | `materialType: 'phong', shininess: 10, specularColor: 0x050505` |
| **Glossy** | `materialType: 'phong', shininess: 100, specularColor: 0xffffff` |
| **Chrome** | `materialType: 'phong', shininess: 200, specularColor: 0x888888` |

#### PBR Presets
| Preset | Configuration |
|--------|--------------|
| **Plastic** | `materialType: 'standard', metalness: 0, roughness: 0.3` |
| **Rubber** | `materialType: 'standard', metalness: 0, roughness: 0.8` |
| **Metal** | `materialType: 'standard', metalness: 1, roughness: 0.2` |
| **Gold** | `materialType: 'standard', metalness: 1, roughness: 0.1, color: 0xFFD700` |
| **Copper** | `materialType: 'standard', metalness: 1, roughness: 0.3, color: 0xB87333` |
| **Glass** | `materialType: 'physical', metalness: 0, roughness: 0, alpha: 0.3` |
| **Ice** | `materialType: 'physical', metalness: 0, roughness: 0.05, alpha: 0.7` |
| **Ceramic** | `materialType: 'standard', metalness: 0, roughness: 0.05` |

#### Parameter Comparison
| Property | Phong Range | PBR Range | Conversion |
|----------|------------|-----------|------------|
| **Shininess** | 0-200 | - | shininess ≈ (1 - roughness) × 200 |
| **Roughness** | - | 0-1 | roughness ≈ 1 - (shininess / 200) |
| **Specular** | Color | - | Use metalness instead |
| **Metalness** | - | 0-1 | Binary for most materials |

### PBR Best Practices

1. **Metalness is usually binary**: Real materials are either metallic (1.0) or dielectric (0.0). Values between 0.2-0.8 are rare in nature.

2. **Roughness varies more**: This is where you get most variation in appearance:
   - 0.0-0.2: Very shiny (polished metal, glass)
   - 0.3-0.5: Semi-gloss (plastic, painted surfaces)
   - 0.6-0.8: Matte (rubber, fabric)
   - 0.9-1.0: Very rough (concrete, clay)

3. **Lighting is crucial for PBR**: Standard and Physical materials need good lighting:
   - Use multiple light sources
   - Environment maps help metallic surfaces
   - Higher ambient light than with Phong

4. **Color handling differs**:
   - **Metals**: Tint reflects their base color
   - **Non-metals**: Keep base color, no tinting in reflections

## Scene Lighting

Scene lighting affects all surfaces in the viewer. Multiple light types can be combined for realistic illumination. PBR materials especially benefit from comprehensive lighting setups.

### Light Types

#### Ambient Light
Provides overall illumination without direction or shadows.

```javascript
const ambientLight = new THREE.AmbientLight(
  0xa0a0a0,  // Color (typically neutral gray)
  1.0        // Intensity multiplier
);
viewer.scene.add(ambientLight);
```

#### Directional Light
Primary light source that creates shadows and depth.

```javascript
const directionalLight = new THREE.DirectionalLight(
  0xffffff,  // Color (typically white)
  1.2        // Intensity
);
directionalLight.position.set(100, 100, 50);  // Direction vector
viewer.scene.add(directionalLight);
```

#### Fill Light
Secondary directional light to soften shadows.

```javascript
const fillLight = new THREE.DirectionalLight(0xffffff, 0.5);
fillLight.position.set(-100, -100, -50);  // Opposite main light
viewer.scene.add(fillLight);
```

#### Point Light
Radiates from a single point for accent lighting.

```javascript
const pointLight = new THREE.PointLight(
  0xff4444,  // Color
  1.0,       // Intensity
  1000       // Distance (range of effect)
);
pointLight.position.set(0, 50, 100);
viewer.scene.add(pointLight);
```

### Lighting Presets

| Preset | Description | Configuration |
|--------|-------------|--------------|
| **Bright** | Clinical, high visibility | Ambient: 120%, Directional: 150%, Fill: 70% |
| **Soft** | Balanced, natural | Ambient: 100%, Directional: 80%, Fill: 60% |
| **Dramatic** | High contrast | Ambient: 40%, Directional: 200%, Fill: 10% |
| **Dark** | Subdued | Ambient: 30%, Directional: 50%, Fill: 20% |
| **Sunset** | Warm tones | Ambient: #ffa050 80%, Directional: #ffcc66 100% |
| **Clinical** | Even, bright | Ambient: 110%, Directional: 100%, Fill: 80% |

## Geometry Smoothing

Two types of smoothing are available:

### Shading Smoothing (Visual Only)

Controls how surface normals are interpolated for rendering. Doesn't modify actual geometry.

```javascript
// Smooth shading - interpolates normals
surface.setSmoothShading(true);

// Flat shading - one normal per face
surface.setSmoothShading(false);

// Angle-based smoothing - preserves sharp edges
surface.setSmoothShading(true, 30);  // 30° threshold
```

### Laplacian Smoothing (Modifies Geometry)

Physically smooths the surface by moving vertices.

#### Standard Laplacian
Moves vertices toward neighbor average. May shrink surface.

```javascript
surface.applyLaplacianSmoothing(
  3,           // iterations (1-10)
  0.5,         // lambda (0-1, strength)
  'laplacian', // method
  true         // preserve boundaries
);
```

#### Taubin Smoothing
Alternates shrink/expand passes to preserve volume.

```javascript
surface.applyLaplacianSmoothing(
  3,       // iterations
  0.5,     // lambda (positive factor)
  'taubin', // method
  true     // preserve boundaries
);
```

#### Parameters Guide

| Parameter | Range | Effect |
|-----------|-------|--------|
| **Iterations** | 1-10 | More = smoother (may lose detail) |
| **Lambda** | 0-1 | 0 = no effect, 1 = maximum smoothing |
| **Method** | laplacian/taubin | Laplacian shrinks, Taubin preserves volume |
| **Boundaries** | true/false | true = edges stay fixed |

### Non-Destructive Smoothing

Create a smoothed copy without modifying original:

```javascript
const smoothedGeometry = surface.createSmoothedCopy(
  3,           // iterations
  0.5,         // lambda
  'taubin'     // method
);
```

## Complete Examples

### Basic Surface Setup

```javascript
import { NeuroSurfaceViewer, ColorMappedNeuroSurface, loadSurface } from 'surfviewjs';

// Create viewer
const viewer = new NeuroSurfaceViewer(container, width, height);

// Load surface geometry
const geometry = await loadSurface('brain.gii', 'gifti');

// Create surface with PBR material
const surface = new ColorMappedNeuroSurface(
  geometry,
  null,      // indices (null = identity mapping)
  data,      // vertex data array
  'viridis', // colormap
  {
    materialType: 'standard',  // Use PBR
    metalness: 0.0,            // Non-metallic
    roughness: 0.5,            // Semi-gloss
    emissive: 0x0a0a0a,
    emissiveIntensity: 0.1,
    alpha: 1.0,
    flatShading: false
  }
);

// Add to viewer
viewer.addSurface(surface, 'brain-surface');
viewer.startRenderLoop();
```

### Custom Lighting Setup

```javascript
// Remove default lights
viewer.scene.remove(viewer.ambientLight);
viewer.scene.remove(viewer.directionalLight);

// Add custom lighting
const ambient = new THREE.AmbientLight(0xa0a0a0, 1.0);
const main = new THREE.DirectionalLight(0xffffff, 1.2);
const fill = new THREE.DirectionalLight(0xffffff, 0.5);

main.position.set(100, 100, 50);
fill.position.set(-100, -100, -50);

viewer.scene.add(ambient);
viewer.scene.add(main);
viewer.scene.add(fill);
```

### Progressive Smoothing

```javascript
// Start with noisy surface
const surface = createSurface(noisyData);

// Apply gentle smoothing
surface.applyLaplacianSmoothing(2, 0.3, 'laplacian', true);

// User wants more smoothing
surface.applyLaplacianSmoothing(1, 0.4, 'taubin', true);

// Reset to original if needed
surface.geometry.vertices.set(originalVertices);
surface.updateMesh();
```

## UI Implementation Guide

### Recommended Control Layout

#### Material Controls
- **Material Type**: Dropdown (Phong/Standard/Physical)

**For Phong Material:**
- **Shininess**: Slider (0-200)
- **Specular Color**: Color picker

**For PBR Materials:**
- **Metalness**: Slider (0-100%)
- **Roughness**: Slider (0-100%)

**Common Controls:**
- **Base Color**: Color picker
- **Emissive Color**: Color picker
- **Emissive Intensity**: Slider (0-100%)
- **Opacity**: Slider (0-100%)
- **Flat Shading**: Toggle
- **Wireframe**: Toggle

#### Lighting Controls
- **Ambient Light**
  - Color picker
  - Intensity slider (0-200%)
- **Directional Light**
  - Color picker
  - Intensity slider (0-200%)
  - Position controls (optional)
- **Fill Light**
  - Intensity slider (0-100%)
- **Point Light**
  - Enable toggle
  - Color picker
  - Intensity slider (0-100%)

#### Smoothing Controls
- **Shading**
  - Smooth/Flat toggle
  - Smoothing angle slider (0-180°)
- **Laplacian Smoothing**
  - Iterations slider (1-10)
  - Lambda slider (0-100%)
  - Method dropdown (Laplacian/Taubin)
  - Preserve boundaries checkbox
  - Apply button
  - Reset button

### Event Handling Example

```javascript
// Material property slider
document.getElementById('shininess').addEventListener('input', (e) => {
  surface.updateConfig({ shininess: parseInt(e.target.value) });
  viewer.render();
});

// Lighting intensity
document.getElementById('ambient-intensity').addEventListener('input', (e) => {
  ambientLight.intensity = e.target.value / 100;
  viewer.render();
});

// Apply smoothing
document.getElementById('apply-smooth').addEventListener('click', () => {
  const iterations = parseInt(iterSlider.value);
  const lambda = lambdaSlider.value / 100;
  const method = methodSelect.value;
  
  surface.applyLaplacianSmoothing(iterations, lambda, method, true);
  viewer.render();
});
```

### State Management

```javascript
class SurfaceController {
  constructor(surface, viewer) {
    this.surface = surface;
    this.viewer = viewer;
    this.originalGeometry = null;
    this.smoothingCount = 0;
  }
  
  saveOriginalGeometry() {
    this.originalGeometry = new Float32Array(this.surface.geometry.vertices);
  }
  
  resetGeometry() {
    if (this.originalGeometry) {
      this.surface.geometry.vertices.set(this.originalGeometry);
      this.surface.updateMesh();
      this.smoothingCount = 0;
      this.viewer.render();
    }
  }
  
  applySmoothingWithTracking(iterations, lambda, method) {
    this.surface.applyLaplacianSmoothing(iterations, lambda, method, true);
    this.smoothingCount++;
    this.viewer.render();
  }
}
```

## Performance Considerations

### Optimization Tips

1. **Batch Updates**: Update multiple properties at once
   ```javascript
   surface.updateConfig({
     shininess: 100,
     alpha: 0.8,
     flatShading: false
   });
   ```

2. **Limit Smoothing Iterations**: More than 5-10 iterations rarely improves results

3. **Use RequestAnimationFrame**: For smooth UI updates
   ```javascript
   function updateLighting() {
     requestAnimationFrame(() => {
       light.intensity = slider.value / 100;
       viewer.render();
     });
   }
   ```

4. **Cache Geometry**: Save original geometry before smoothing for quick reset

### Browser Compatibility

- WebGL 2.0 required
- Modern browsers (Chrome 80+, Firefox 75+, Safari 13+, Edge 80+)
- Mobile support varies by device GPU capabilities

## Troubleshooting

### Common Issues

| Issue | Solution |
|-------|----------|
| Surface appears black | Increase ambient light or add emissive color |
| Transparency not working | Ensure `alpha < 1` and `depthWrite: false` |
| Smoothing has no effect | Check lambda > 0 and iterations > 0 |
| Point light not visible | Increase intensity range or move closer to surface |
| Performance issues | Reduce polygon count or smoothing iterations |

### Debug Mode

Enable debug logging:

```javascript
import { setDebug } from 'surfviewjs';
setDebug(true);
```

## API Reference

### Classes

- `NeuroSurfaceViewer` - Main viewer class
- `ColorMappedNeuroSurface` - Surface with data-driven coloring
- `VertexColoredNeuroSurface` - Surface with per-vertex colors
- `SurfaceGeometry` - Geometry container
- `LaplacianSmoothing` - Smoothing utilities
- `ColorMap` - Color mapping utilities
- `detectCapabilities(renderer)` - helper to capture WebGL/WebWorker support flags (webgl2, uint32Indices, floatTextures, etc.)

### Methods

See inline documentation in source files for detailed method signatures and examples.

### Picking and Annotations

- `viewer.pick({ x?, y?, opacityThreshold? })` returns `{ surfaceId, vertexIndex, point }`, choosing the closest vertex of the hit triangle and ignoring meshes below the opacity threshold.
- `viewer.addAnnotation(surfaceId, vertexIndex, data?, options?)` places a small marker on the mesh and returns an annotation id. Options: `radius`, `colorOn`, `colorOff`, `active`.
- `viewer.activateAnnotation(id, { exclusive })`, `viewer.removeAnnotation(id)`, `viewer.clearAnnotations()`, `viewer.getAnnotation(id)` allow basic annotation lifecycle control.
- Annotation events: `annotation:added`, `annotation:removed`, `annotation:activated`, `annotation:reset`.

### Presets & Style

- `config.preset = 'presentation'` (or `viewer.applyPresentationPreset()`) sets a soft gradient background via CSS, transparent canvas, brighter ambient light, subtle rim, and slightly stronger SSAO for ready-to-drop static renders.
- New config `linkHemispheres` (reserved for future synchronized hemi control; defaults to `false`).
