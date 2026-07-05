# Events

SurfView.js uses events for viewer state, picking, surface/layer changes, annotations, rendering, and plugin panels. The public viewer event names and payloads are defined by `ViewerEventMap`.

## Viewer Events

### Surface Events

```javascript
viewer.on('surface:added', ({ surfaceId, surface }) => {
  console.log(`Surface ${surfaceId} added`, surface);
});

viewer.on('surface:removed', ({ surfaceId }) => {
  console.log(`Surface ${surfaceId} removed`);
});

viewer.on('surface:variant', ({ surfaceId, variant }) => {
  console.log(`Surface ${surfaceId} switched to variant ${variant}`);
});

viewer.on('surface:colormap', ({ surfaceId, colormap }) => {
  console.log(`Surface ${surfaceId} colormap changed to ${colormap}`);
});
```

### Layer Events

Viewer-level layer events are forwarded from `MultiLayerNeuroSurface` instances after they are added to the viewer.

```javascript
viewer.on('layer:added', ({ surfaceId, layerId, layer }) => {
  console.log(`Layer ${layerId} added to ${surfaceId}`, layer);
});

viewer.on('layer:removed', ({ surfaceId, layerId }) => {
  console.log(`Layer ${layerId} removed from ${surfaceId}`);
});

viewer.on('layer:updated', ({ surfaceId, layerId, layer, changes }) => {
  console.log(`Layer ${layerId} updated on ${surfaceId}`, layer, changes);
});

viewer.on('layer:colormap', ({ surfaceId, layerId, colormap }) => {
  console.log(`Layer ${layerId} on ${surfaceId} changed to ${colormap}`);
});

viewer.on('layer:intensity', ({ surfaceId, layerId, range }) => {
  console.log(`Layer ${layerId} intensity range`, range);
});

viewer.on('layer:threshold', ({ surfaceId, layerId, threshold }) => {
  console.log(`Layer ${layerId} threshold`, threshold);
});

viewer.on('layer:opacity', ({ surfaceId, layerId, opacity }) => {
  console.log(`Layer ${layerId} opacity changed to ${opacity}`);
});
```

### Picking Events

```javascript
viewer.on('surface:click', (hit) => {
  if (hit.surfaceId && hit.vertexIndex !== null) {
    console.log(`Clicked ${hit.surfaceId} at vertex ${hit.vertexIndex}`);
    console.log('Position:', hit.point);
  }
});

viewer.on('mouse:click', ({ position, surface, point }) => {
  console.log('Mouse click in normalized device coordinates:', position, surface, point);
});
```

### Hover Events

```javascript
viewer.on('vertex:hover', ({ surfaceId, vertexIndex, screenX, screenY }) => {
  if (surfaceId && vertexIndex !== null) {
    console.log(`Hovering ${surfaceId} vertex ${vertexIndex} at (${screenX}, ${screenY})`);
  } else {
    console.log('Hover left surface');
  }
});
```

This event is useful for wiring up sparkline tooltips with `SparklineOverlay`. See the [Temporal Playback](/guide/temporal) guide.

### Parcel Interaction Events

When the hovered or clicked surface provides parcel metadata, the viewer emits parcel-native interaction events. These are intended for synchronizing external views such as parcel heatmaps, tables, or connectivity matrices.

```javascript
viewer.on('parcel:hover', ({ parcelId, parcelLabel, atlasId, surfaceId }) => {
  if (parcelId === null) {
    heatmap.clearHover();
    return;
  }

  heatmap.setHoverParcel(parcelId);
  console.log(`Hover parcel ${parcelLabel} on ${surfaceId} (${atlasId})`);
});

viewer.on('parcel:click', ({ parcelId }) => {
  if (parcelId === null) {
    return;
  }

  heatmap.setSelectedParcel(parcelId);
});

viewer.on('parcel:selected', ({ parcelId, selected }) => {
  console.log('Parcel selection:', parcelId, selected);
});
```

`parcel:hover` is emitted with `parcelId: null` when the pointer leaves parcelized geometry, so external views can clear their hover state without listening to lower-level vertex events.

External views can also drive the viewer back through the same parcel state:

```javascript
heatmap.onHoverParcel((parcelId) => {
  if (parcelId === null) {
    viewer.clearParcelHover();
    return;
  }

  viewer.setParcelHover('parcel-connectivity', parcelId);
});

heatmap.onSelectParcel((parcelId) => {
  if (parcelId === null) {
    viewer.clearParcelSelection();
    return;
  }

  viewer.setParcelSelection('parcel-connectivity', parcelId);
});
```

These methods use a parcelized surface's representative vertex internally, so external tools can synchronize hover and selection without synthesizing mouse events.

### Annotation Events

```javascript
viewer.on('annotation:added', ({ id, surfaceId, vertexIndex, annotation }) => {
  console.log(`Annotation ${id} added on ${surfaceId} at ${vertexIndex}`, annotation);
});

viewer.on('annotation:moved', ({ id, vertexIndex }) => {
  console.log(`Annotation ${id} moved to vertex ${vertexIndex}`);
});

viewer.on('annotation:removed', ({ id }) => {
  console.log(`Annotation ${id} removed`);
});

viewer.on('annotation:activated', ({ id, active }) => {
  console.log(`Annotation ${id} active: ${active}`);
});

viewer.on('annotation:reset', () => {
  console.log('All annotations cleared');
});
```

### Render Events

```javascript
viewer.on('render:needed', () => {
  console.log('A render has been requested');
});

viewer.on('render:before', () => {
  console.log('About to render');
});

viewer.on('render:after', () => {
  console.log('Rendered frame');
});
```

`render:needed` is emitted when the viewer transitions from idle to needing a render. `render:before` and `render:after` are emitted around actual frame rendering.

### View, Resize, And Controls Events

```javascript
viewer.on('viewpoint:changed', ({ viewpoint, position, target }) => {
  console.log(`Viewpoint changed to ${viewpoint}`, position, target);
});

viewer.on('camera:changed', ({ camera, position, target }) => {
  console.log('Camera changed', camera, position, target);
});

viewer.on('resize', ({ width, height }) => {
  console.log(`Viewer resized to ${width}x${height}`);
});

viewer.on('controls:changed', ({ enabled }) => {
  console.log(`Controls enabled: ${enabled}`);
});

viewer.on('controls:error', ({ error }) => {
  console.error('Controls error:', error);
});
```

### State Events

```javascript
viewer.on('state:restored', (report) => {
  console.log('State restored:', report.success, report.warnings);
});
```

## Plugin Panels

Plugins mount into an element and subscribe through the typed viewer event API. Subscriptions made through `api.on()` are removed automatically when the plugin is unregistered.

```javascript
viewer.registerPlugin({
  id: 'retinotopy-panel',
  mount(container, api) {
    const label = document.createElement('div');
    container.appendChild(label);

    api.on('vertex:hover', ({ surfaceId, vertexIndex }) => {
      label.textContent = surfaceId && vertexIndex !== null
        ? `${surfaceId}:${vertexIndex}`
        : '';
    });

    return () => {
      container.textContent = '';
    };
  }
});

viewer.unregisterPlugin('retinotopy-panel');
```

## Temporal Events

`TimelineController` has its own typed event map for temporal playback.

```javascript
timeline.on('timechange', ({ time, frameA, frameB, alpha }) => {
  console.log(`t=${time}`, frameA, frameB, alpha);
});

timeline.on('play', () => {
  console.log('Timeline started');
});

timeline.on('pause', () => {
  console.log('Timeline paused');
});

timeline.on('stop', () => {
  console.log('Timeline stopped');
});
```

## Removing Listeners

```javascript
const handler = (event) => console.log(event);

viewer.on('surface:click', handler);
viewer.off('surface:click', handler);
```

## One-Time Listeners

```javascript
viewer.once('surface:added', ({ surfaceId }) => {
  console.log(`First surface added: ${surfaceId}`);
});
```
