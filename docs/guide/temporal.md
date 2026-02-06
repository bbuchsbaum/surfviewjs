# Temporal Playback

SurfView.js supports animated time-series data on brain surfaces with smooth frame interpolation, playback controls, and hover sparkline tooltips.

## Overview

The temporal system has three decoupled components:

| Component | Role |
|-----------|------|
| `TemporalDataLayer` | Stores T frames of per-vertex data; interpolates between frames on demand |
| `TimelineController` | Playback state machine (play/pause/seek/speed/loop); emits `timechange` events |
| `SparklineOverlay` | Hover tooltip showing a vertex's time series as a mini line chart |

**Data flow:**

```
TimelineController (play/pause/seek)
  -> emits 'timechange' { time, frameA, frameB, alpha }
    -> TemporalDataLayer.setTime(frameA, frameB, alpha)
      -> interpolates scalar values, then colormaps
        -> surface.requestColorUpdate() -> render
```

## TemporalDataLayer

Extends `DataLayer` with multiple temporal frames. Interpolation happens on raw scalar values *before* colormapping, which produces correct visual blending.

### Constructor

```typescript
new TemporalDataLayer(
  id: string,
  frames: Float32Array[],  // T arrays, each of length V (vertices)
  times: number[],         // sorted time values, length T
  colorMap: string,        // colormap name (e.g. 'hot', 'viridis')
  config: TemporalDataConfig
)
```

### Config Options

`TemporalDataConfig` extends the standard `DataLayerConfig`:

| Option | Type | Description |
|--------|------|-------------|
| `range` | `[min, max]` | Data range for colormap |
| `threshold` | `[low, high]` | Values inside threshold are transparent |
| `opacity` | `number` | Layer opacity (0-1) |
| `blendMode` | `string` | Blend mode (`'normal'`, `'additive'`, etc.) |
| `order` | `number` | Layer stacking order |
| `factor` | `FactorDescriptor` | Optional experimental design descriptor |

### Example

```javascript
import { TemporalDataLayer } from 'surfview';

// 60 frames of activation data, each with vertexCount values
const layer = new TemporalDataLayer('activation', frames, times, 'hot', {
  range: [0, 1],
  threshold: [0.15, 0],
  opacity: 0.85
});

surface.addLayer(layer);
```

### Key Methods

```javascript
// Interpolate between frames (called by TimelineController)
layer.setTime(frameA, frameB, alpha);

// Extract time series for a single vertex (for sparklines)
const series = layer.getTimeSeries(vertexIndex); // Float32Array of length T

// Metadata
layer.getFrameCount();    // number of frames
layer.getVertexCount();   // vertices per frame
layer.getTimes();         // copy of time values
layer.getFactorDescriptor(); // FactorDescriptor | null
```

## TimelineController

A pure playback state machine that knows nothing about layers or rendering. It uses `requestAnimationFrame` internally and emits events with frame interpolation data.

### Constructor

```typescript
new TimelineController(times: number[], options?: {
  speed?: number,     // playback speed multiplier (default: 1)
  loop?: LoopMode,    // 'none' | 'loop' | 'bounce' (default: 'loop')
  autoPlay?: boolean  // start playing immediately (default: false)
})
```

### Methods

| Method | Description |
|--------|-------------|
| `play()` | Start playback |
| `pause()` | Pause playback |
| `stop()` | Stop and reset to beginning |
| `toggle()` | Toggle play/pause |
| `seek(time)` | Jump to a specific time (clamped to range) |
| `setSpeed(multiplier)` | Set playback speed (e.g. 0.5, 1, 2) |
| `setLoop(mode)` | Set loop mode: `'none'`, `'loop'`, or `'bounce'` |
| `getState()` | Returns full `TimelineState` snapshot |
| `dispose()` | Stop playback and remove all listeners |

### Events

| Event | Payload | Description |
|-------|---------|-------------|
| `timechange` | `{ time, frameA, frameB, alpha }` | Emitted each animation frame |
| `play` | — | Playback started |
| `pause` | — | Playback paused |
| `stop` | — | Playback stopped and reset |

### Wiring It Together

```javascript
import { TimelineController, TemporalDataLayer } from 'surfview';

const timeline = new TimelineController(times, { speed: 0.5, loop: 'loop' });

// Drive the layer from the timeline
timeline.on('timechange', (e) => {
  temporalLayer.setTime(e.frameA, e.frameB, e.alpha);
  surface.requestColorUpdate();
});

// Controls
timeline.play();
timeline.seek(0.75);       // jump to t=0.75
timeline.setSpeed(2);      // double speed
timeline.setLoop('bounce'); // ping-pong
```

## SparklineOverlay

A lightweight hover tooltip that renders a vertex's time series as a mini line chart on a floating `<canvas>`. Uses Canvas 2D for performance.

### Constructor

```typescript
new SparklineOverlay(container: HTMLElement, options?: SparklineOptions)
```

### Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `width` | `number` | 200 | Canvas width in pixels |
| `height` | `number` | 80 | Canvas height in pixels |
| `lineColor` | `string` | `'#00ccff'` | Time series line color |
| `bgColor` | `string` | `'rgba(0,0,0,0.85)'` | Background color |
| `timeMarkerColor` | `string` | `'#ff4444'` | Vertical playhead marker color |
| `padding` | `number` | 8 | Internal padding |

### Methods

```javascript
// Show sparkline near the mouse
sparkline.show(timeSeries, times, currentTime, screenX, screenY);

// Hide sparkline
sparkline.hide();

// Update just the time marker (efficient during playback)
sparkline.updateTimeMarker(currentTime);

// Clean up
sparkline.dispose();
```

### Hover Integration

Wire the sparkline to the viewer's `vertex:hover` event:

```javascript
const sparkline = new SparklineOverlay(container, {
  width: 220, height: 90,
  lineColor: '#ff8800',
  timeMarkerColor: '#ff2222'
});

viewer.on('vertex:hover', (e) => {
  if (e.surfaceId && e.vertexIndex !== null) {
    const series = temporalLayer.getTimeSeries(e.vertexIndex);
    const state = timeline.getState();
    sparkline.show(series, times, state.currentTime, e.screenX, e.screenY);
  } else {
    sparkline.hide();
  }
});

// Keep the time marker in sync during playback
timeline.on('timechange', (e) => {
  sparkline.updateTimeMarker(e.time);
});
```

## Factor Descriptors

For experimental designs, you can attach a `FactorDescriptor` to a temporal layer. This maps each timepoint to a condition/factor level, enabling color-coded sparkline segments.

```typescript
interface FactorDescriptor {
  name: string;        // e.g. 'condition'
  levels: string[];    // e.g. ['rest', 'task']
  assignment: number[]; // index into levels for each timepoint (length = T)
}
```

```javascript
const layer = new TemporalDataLayer('activation', frames, times, 'hot', {
  range: [0, 1],
  factor: {
    name: 'condition',
    levels: ['rest', 'task'],
    assignment: [0, 0, 0, 1, 1, 1, 0, 0, 0, 1, 1, 1] // one per frame
  }
});
```

When a factor is provided, the sparkline overlay draws color-coded background strips for each condition segment.

## Full Example

```javascript
import {
  NeuroSurfaceViewer, MultiLayerNeuroSurface, SurfaceGeometry,
  TemporalDataLayer, TimelineController, SparklineOverlay,
  loadSurface
} from 'surfview';

// Setup
const container = document.getElementById('viewer');
const viewer = new NeuroSurfaceViewer(container, 800, 600, {
  showControls: true,
  enableHoverCrosshair: true
});

const geometry = await loadSurface('brain.surf.gii', 'gifti', 'left');
const surface = new MultiLayerNeuroSurface(geometry, { baseColor: 0x888888 });

// Temporal layer (frames and times from your data pipeline)
const layer = new TemporalDataLayer('bold', frames, times, 'hot', {
  range: [-3, 3],
  threshold: [-1, 0],
  opacity: 0.85
});
surface.addLayer(layer);
viewer.addSurface(surface, 'brain');
viewer.centerCamera();

// Playback
const timeline = new TimelineController(times, { speed: 0.5, loop: 'loop' });
timeline.on('timechange', (e) => {
  layer.setTime(e.frameA, e.frameB, e.alpha);
  surface.requestColorUpdate();
});

// Sparkline hover
const sparkline = new SparklineOverlay(container, {
  lineColor: '#ff8800', timeMarkerColor: '#ff2222'
});

viewer.on('vertex:hover', (e) => {
  if (e.vertexIndex !== null) {
    sparkline.show(layer.getTimeSeries(e.vertexIndex), times,
      timeline.getState().currentTime, e.screenX, e.screenY);
  } else {
    sparkline.hide();
  }
});

timeline.on('timechange', (e) => sparkline.updateTimeMarker(e.time));

// Start
timeline.play();
viewer.startRenderLoop();
```

## Cleanup

Always dispose temporal resources when done:

```javascript
timeline.dispose();   // stops rAF, removes listeners
sparkline.dispose();  // removes canvas from DOM
surface.dispose();    // disposes layers + geometry
```
