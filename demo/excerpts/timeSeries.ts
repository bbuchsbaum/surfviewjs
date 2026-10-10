import { SparklineOverlay, TemporalDataLayer, TimelineController } from '@src/index.js';
import type { MultiLayerNeuroSurface, NeuroSurfaceViewer } from '@src/index.js';

// frames: one Float32Array of vertex values per time point; times in seconds.
export function playSeries(viewer: NeuroSurfaceViewer, surface: MultiLayerNeuroSurface, frames: Float32Array[], times: number[]) {
  const layer = new TemporalDataLayer('bold', frames, times, 'coolwarm', {
    range: [-1.5, 1.5],
    threshold: [-0.2, 0.2] // ascending bounds: values inside (−0.2, 0.2) are hidden
  });
  surface.addLayer(layer);

  const span = times[times.length - 1]! - times[0]!;
  const timeline = new TimelineController(times, { speed: 8 / span, loop: 'loop' }); // 8× real time
  timeline.on('timechange', ({ frameA, frameB, alpha }) => {
    layer.setTime(frameA, frameB, alpha);
    surface.requestColorUpdate();
  });

  const sparkline = new SparklineOverlay(viewer.container, { width: 220, height: 84 });
  viewer.on('vertex:hover', ({ vertexIndex, screenX, screenY }) => {
    if (vertexIndex === null) return sparkline.hide();
    sparkline.show(layer.getTimeSeries(vertexIndex), times, timeline.getState().currentTime, screenX, screenY);
  });
  timeline.play();
  return timeline;
}
