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

### Scientific Selection Events

`selection:changed` is the canonical scientific-selection event. Its payload
contains immutable current and previous selections and never contains a live
surface, layer, annotation, or Three.js object.

```javascript
viewer.on('selection:changed', ({ selection, previous }) => {
  console.log('Inspection selection:', previous, '→', selection);
});

viewer.setInspectionSelection({
  kind: 'parcel',
  surfaceId: 'parcel-connectivity',
  parcelId: 17
});
```

Successful changes invalidate the `selection` state domain. Repeating the
same selection is a successful no-op and emits no event. Invalid commands are
atomic. `parcel:selected` remains as a compatibility interaction event;
panel-local layer focus and annotation activation are not inspection
selection.

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
  console.log(`Camera interaction enabled: ${enabled}`);
});

viewer.on('controls:error', ({ error }) => {
  console.error('Controls error:', error);
});
```

`controls:changed` retains its 2.x event name for compatibility, but its payload
describes camera and surface interaction. Prefer `setInteractionEnabled()` when
changing that state; it is unrelated to optional panel visibility.

### State Events

```javascript
viewer.on('state:changed', ({ revision, domains }) => {
  console.log(`Viewer state revision ${revision}`, domains);
});

viewer.on('state:restored', (report) => {
  console.log('State restored:', report.success, report.errors, report.warnings);
});
```

`state:restored` is also emitted for rejected input. `report.errors` contains
validation issues with `code`, `path`, and `message`; validation errors are
reported before mutation, so a failed restore does not advance the canonical
state revision. `report.warnings` is reserved for runtime adapter failures that
occur only after validation succeeds.

`state:changed` is the dependable coarse invalidation contract for external
controllers. `revision` increases monotonically, and `domains` contains one or
more of `camera`, `surfaces`, `layers`, `selection`, `appearance`, and
`timeline`. Compound viewer operations may combine several domains into one
revision. `viewer.getStateRevision()` returns the most recently issued
revision. Direct public layer setters are included: for example,
`layer.setOpacity()` and `layer.setRange()` produce a `layers` invalidation and
a `layer:updated` event whose `changes` payload identifies the changed
properties.

The event is synchronous state invalidation, not a render-completed signal.
Do not infer state mutations from `render:needed`, animation frames, or
`requestRender()`; render requests can occur without any canonical state
change. Use `render:after` only when work truly depends on a completed frame.

## Plugin Panels

Plugins mount into an element and subscribe through the typed viewer event API. Subscriptions made through `api.on()` are removed automatically when the plugin is unregistered.

```javascript
const registration = viewer.registerPlugin({
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

// Either path deregisters and tears down exactly once.
registration.dispose();
viewer.unregisterPlugin('retinotopy-panel'); // false after direct disposal
```

Registration disposal is idempotent. Direct handle disposal removes the plugin
from `getPlugin()` and `listPlugins()` immediately; later unregister, viewer
disposal, or repeated handle disposal does not invoke teardown again. Viewer
disposal also removes viewer event listeners, so no further viewer
notifications are delivered.

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

timeline.on('speedchange', ({ speed }) => {
  console.log('Timeline speed:', speed);
});

timeline.on('loopchange', ({ loopMode }) => {
  console.log('Timeline loop mode:', loopMode);
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
