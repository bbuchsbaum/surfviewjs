import { GeodesicIndex, OutlineLayer, SurfaceMetric, getDisplayGeometryBinding, summarizeSurfaceRegion } from '@src/index.js';
import type { NeuroSurfaceViewer, SurfaceGeometry, SurfaceLocation } from '@src/index.js';

export function inspect(viewer: NeuroSurfaceViewer, readout: HTMLOutputElement, marks: HTMLOListElement) {
  viewer.enableGPUPicking(); // false when unsupported; pick() then raycasts on the CPU
  viewer.updateConfig({ hoverCrosshair: true, hoverCrosshairColor: 0xedf2f5 });
  viewer.annotations.setDefaults({ radius: 1.8, colorOn: 0xf2c230, colorOff: 0xf2c230 });

  const canvas = viewer.renderer.domElement;
  const onMove = (event: PointerEvent) => {
    const start = performance.now();
    const hit = viewer.pick({ x: event.clientX, y: event.clientY, useGPU: true });
    const ms = performance.now() - start;
    if (hit.surfaceId && hit.vertexIndex !== null) {
      const info = viewer.inspectVertex(hit.surfaceId, hit.vertexIndex);
      readout.value = `${ms.toFixed(2)} ms · ${info?.world.map(c => c.toFixed(1)).join(', ')} · ${info?.values[0]?.value}`;
    }
  };
  canvas.addEventListener('pointermove', onMove);

  // A click pins a selection crosshair; drop a labelled mark there too.
  viewer.on('surface:click', ({ surfaceId, vertexIndex }) => {
    if (!surfaceId || vertexIndex === null) return;
    const hit = viewer.pickSurfaceLocation(); // CPU triangle hit includes GPU morph positions
    if (!hit.location) return;
    const id = viewer.annotations.addAnchor(surfaceId, { location: hit.location }, { label: `M${marks.children.length + 1}` });
    if (id) marks.append(Object.assign(document.createElement('li'), { textContent: id }));
  });
  return () => { canvas.removeEventListener('pointermove', onMove); viewer.clearAnnotations(); };
}

export function measureSurface(viewer: NeuroSurfaceViewer, pial: SurfaceGeometry, start: SurfaceLocation, end: SurfaceLocation, seed: number) {
  const domain = getDisplayGeometryBinding(viewer.getSurface('lh')!.mesh!).domain;
  const metric = new SurfaceMetric(domain, { positions: pial.vertices, frame: 'fsaverage5-RAS', units: 'mm' });
  const index = new GeodesicIndex(metric); // reuse it for subsequent queries
  const path = index.shortestPathLocations(start, end); // virtual endpoints, no vertex snapping
  const roi = new Uint8Array(domain.vertexCount);
  index.withinRadius([seed], 10).vertices.forEach(v => { roi[v] = 1; });
  viewer.addLayer('lh', new OutlineLayer('brush', { roiLabels: Uint32Array.from(roi), boundaryMode: 'midpoint', color: 0xf2c230, width: 2 }));
  const area = summarizeSurfaceRegion(metric, roi, { mode: 'vertex-membership', roi }).totalAreaMm2;
  return { path, area }; // path length is mm; area is mm²; display morphs leave both unchanged
}
