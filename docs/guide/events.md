# Events

SurfView.js uses an event system for communication between components. Both the viewer and surfaces emit events you can listen to.

## Viewer Events

### Surface Events

```javascript
viewer.on('surface:added', ({ surfaceId, surface }) => {
  console.log(`Surface ${surfaceId} added`);
});

viewer.on('surface:removed', ({ surfaceId }) => {
  console.log(`Surface ${surfaceId} removed`);
});

viewer.on('surface:variant', ({ surfaceId, variant }) => {
  console.log(`Surface ${surfaceId} switched to variant ${variant}`);
});
```

### Layer Events

```javascript
viewer.on('layer:added', ({ surfaceId, layerId }) => {
  console.log(`Layer ${layerId} added to ${surfaceId}`);
});

viewer.on('layer:removed', ({ surfaceId, layerId }) => {
  console.log(`Layer ${layerId} removed from ${surfaceId}`);
});

viewer.on('layer:updated', ({ surfaceId, layerId, changes }) => {
  console.log(`Layer ${layerId} updated`, changes);
});

viewer.on('layer:colormap', ({ layerId, colormap }) => {
  console.log(`Colormap changed to ${colormap}`);
});

viewer.on('layer:intensity', ({ layerId, range }) => {
  console.log(`Intensity range changed to`, range);
});

viewer.on('layer:threshold', ({ layerId, threshold }) => {
  console.log(`Threshold changed to`, threshold);
});

viewer.on('layer:opacity', ({ layerId, opacity }) => {
  console.log(`Opacity changed to ${opacity}`);
});
```

### Interaction Events

```javascript
viewer.on('surface:click', (hit) => {
  if (hit.surfaceId && hit.vertexIndex !== null) {
    console.log(`Clicked ${hit.surfaceId} at vertex ${hit.vertexIndex}`);
    console.log(`Position:`, hit.point);
    console.log(`Normal:`, hit.normal);
  }
});
```

### Annotation Events

```javascript
viewer.on('annotation:added', ({ id, surfaceId, vertexIndex }) => {
  console.log(`Annotation ${id} added`);
});

viewer.on('annotation:moved', ({ id, vertexIndex }) => {
  console.log(`Annotation ${id} moved to vertex ${vertexIndex}`);
});

viewer.on('annotation:removed', ({ id }) => {
  console.log(`Annotation ${id} removed`);
});

viewer.on('annotation:activated', ({ id }) => {
  console.log(`Annotation ${id} activated`);
});

viewer.on('annotation:reset', () => {
  console.log('All annotations cleared');
});
```

### Render Events

```javascript
viewer.on('render:before', () => {
  // Called before each render
});

viewer.on('render:after', () => {
  // Called after each render
});

viewer.on('render:needed', () => {
  // Called when a render is requested
});
```

### Viewpoint Events

```javascript
viewer.on('viewpoint:changed', ({ viewpoint, position }) => {
  console.log(`Viewpoint changed to ${viewpoint}`);
});
```

### Controls Events

```javascript
viewer.on('controls:changed', ({ name, value }) => {
  console.log(`Control ${name} changed to ${value}`);
});

viewer.on('controls:error', ({ error }) => {
  console.error('Controls error:', error);
});
```

## Removing Listeners

```javascript
// Store the handler
const handler = (event) => console.log(event);

// Add listener
viewer.on('surface:click', handler);

// Remove listener
viewer.off('surface:click', handler);
```

## One-time Listeners

```javascript
viewer.once('surface:added', ({ surfaceId }) => {
  console.log(`First surface added: ${surfaceId}`);
});
```

## Event Flow Example

```javascript
// Track all layer changes
viewer.on('layer:updated', ({ surfaceId, layerId, changes }) => {
  // Log to analytics
  analytics.track('layer_updated', { surfaceId, layerId, ...changes });
});

// Sync state with React
viewer.on('layer:opacity', ({ layerId, opacity }) => {
  setLayerOpacity(prev => ({ ...prev, [layerId]: opacity }));
});

// Handle picking
viewer.on('surface:click', (hit) => {
  if (hit.vertexIndex !== null) {
    // Show data at clicked vertex
    const data = getDataAtVertex(hit.surfaceId, hit.vertexIndex);
    showTooltip(hit.point, data);
  }
});
```
