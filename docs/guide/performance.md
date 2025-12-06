# Performance

Tips for optimizing SurfView.js performance with large meshes and multiple layers.

## General Guidelines

### Mesh Complexity

| Vertex Count | Performance | Use Case |
|--------------|-------------|----------|
| < 50,000 | Excellent | Interactive exploration |
| 50,000 - 150,000 | Good | Standard brain surfaces |
| 150,000 - 500,000 | Moderate | High-resolution surfaces |
| > 500,000 | Consider optimization | Very detailed meshes |

### Quick Wins

```javascript
// 1. Disable expensive effects
const viewer = new NeuroSurfaceViewer(container, width, height, {
  showControls: false,  // Disable if not needed
});

// 2. Use basic materials for large meshes
const surface = new MultiLayerNeuroSurface(geometry, {
  materialType: 'basic',  // Instead of 'phong' or 'physical'
  flatShading: true       // Reduces vertex calculations
});

// 3. Reduce pixel ratio on high-DPI displays
viewer.renderer.setPixelRatio(1);  // Instead of devicePixelRatio
```

## Layer Performance

### CPU vs GPU Compositing

```javascript
// GPU compositing is faster with many layers
const surface = new MultiLayerNeuroSurface(geometry, {
  useGPUCompositing: true  // Enable for 3+ layers
});
```

**When to use GPU compositing:**
- 3 or more data layers
- Frequent layer updates
- Real-time animations

**When to use CPU compositing:**
- 1-2 layers
- Infrequent updates
- Maximum compatibility

### Batch Layer Updates

```javascript
// Bad: Multiple individual updates
surface.updateLayer('layer1', { opacity: 0.5 });
surface.updateLayer('layer2', { opacity: 0.8 });
surface.updateLayer('layer3', { range: [-5, 5] });

// Good: Batch update
surface.updateLayers([
  { id: 'layer1', opacity: 0.5 },
  { id: 'layer2', opacity: 0.8 },
  { id: 'layer3', range: [-5, 5] }
]);
```

### Throttle Data Updates

```javascript
// For real-time data, throttle updates
import { throttle } from 'lodash';

const updateData = throttle((newData) => {
  layer.setData(newData);
  surface.updateColors();
}, 50);  // Max 20 updates per second
```

## Rendering Optimization

### Request Renders Instead of Force

```javascript
// Bad: Force immediate render
viewer.render();

// Good: Request render (batches multiple requests)
viewer.requestRender();
```

### Stop Render Loop When Hidden

```javascript
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    viewer.stopRenderLoop();
  } else {
    viewer.startRenderLoop();
  }
});
```

### Resize Handling

```javascript
// Throttle resize handling
const handleResize = throttle(() => {
  viewer.resize(window.innerWidth, window.innerHeight);
}, 100);

window.addEventListener('resize', handleResize);
```

## Memory Management

### Dispose Unused Resources

```javascript
// When removing surfaces
viewer.removeSurface(surface);
surface.dispose();  // Free GPU memory

// When done with viewer
viewer.dispose();
```

### Reuse Geometry

```javascript
// Share geometry between surfaces with same mesh
const geometry = new SurfaceGeometry(vertices, faces, 'brain');

const surface1 = new MultiLayerNeuroSurface(geometry, { baseColor: 0xff0000 });
const surface2 = new MultiLayerNeuroSurface(geometry, { baseColor: 0x0000ff });
```

## Profiling

### Monitor FPS

```javascript
let frameCount = 0;
let lastTime = performance.now();

viewer.on('render:after', () => {
  frameCount++;
  const now = performance.now();
  if (now - lastTime >= 1000) {
    console.log(`FPS: ${frameCount}`);
    frameCount = 0;
    lastTime = now;
  }
});
```

### Three.js Stats

```javascript
import Stats from 'three/examples/jsm/libs/stats.module';

const stats = new Stats();
document.body.appendChild(stats.dom);

viewer.on('render:after', () => stats.update());
```

## Checklist

- [ ] Use `materialType: 'basic'` for large meshes
- [ ] Enable `flatShading` when normals aren't critical
- [ ] Set `pixelRatio` to 1 on high-DPI displays
- [ ] Use GPU compositing with 3+ layers
- [ ] Batch layer updates
- [ ] Throttle real-time data updates
- [ ] Stop render loop when tab is hidden
- [ ] Dispose surfaces when removing
- [ ] Reuse geometry when possible
