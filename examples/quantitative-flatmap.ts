import { FlatMapView, ColorMap, GeometryWorkerClient } from 'surfview';
import { FlatMapViewAttachment, buildSurfaceReliefInWorker, FlatMapChart, FlatMapController, FlatMapFrame, FlatMapSampler, FlatMapField, WebGLFlatMapRenderer, FlatMapSurfaceBinding, flatMapAreaCalibration } from 'surfview/flatmap';
import type { SurfaceMetric, NeuroSurfaceViewer } from 'surfview';

export async function quantitativeFlatmap(
  container: HTMLElement, viewer: NeuroSurfaceViewer, chart: FlatMapChart,
  white: SurfaceMetric, pial: SurfaceMetric, values: Float32Array,
  worker: GeometryWorkerClient
) {
  const presentation = { colorMap: ColorMap.fromPreset('coolwarm', { range: [-1, 1] }) };
  const field = new FlatMapField(presentation);
  const renderer = new WebGLFlatMapRenderer(presentation, { field });
  const controller = new FlatMapController(chart, { worker });
  const sampler = new FlatMapSampler({ kind: 'vertex-scalar', domain: chart.domain });
  controller.setSource(sampler, new FlatMapFrame(values));
  const xy = chart.copyCoordinates(), vertices = new Float32Array(chart.vertexCount * 3);
  for (let v = 0; v < chart.vertexCount; v++) vertices.set([xy[v * 2]!, xy[v * 2 + 1]!, 0], v * 3);
  const view = new FlatMapView(container, { vertices, faces: chart.copyFaces() }, { autoRender: false });
  const attachment = new FlatMapViewAttachment(view, controller, renderer);
  const offRender = view.on('render:needed', () => view.render());
  const relief = await buildSurfaceReliefInWorker(worker, chart, white, pial, {
    mmPerUnit: flatMapAreaCalibration(chart, pial), regularizationFwhmMm: 2.5
  });
  const surface = new FlatMapSurfaceBinding(chart, pial, field, { relief });
  viewer.addSurface(surface, 'quantitative');
  await attachment.prepare(512);
  surface.setDeformation(1, 2, true); // Display-only relief; use (0, 0, false) for folded/unlit.
  // Replacing a frame reuses the same sampler and cached geometry.
  // controller.setSource(sampler, new FlatMapFrame(nextValues));
  // await attachment.prepare(512);
  return () => {
    offRender(); view.dispose(); viewer.removeSurface('quantitative'); surface.dispose();
    controller.dispose(); renderer.dispose(); field.dispose();
    // The injected worker remains caller-owned.
  };
}
