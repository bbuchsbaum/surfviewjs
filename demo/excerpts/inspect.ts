import type { NeuroSurfaceViewer } from '@src/index.js';

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
    const id = viewer.addAnnotation(surfaceId, vertexIndex, { label: `M${marks.children.length + 1}` });
    if (id) marks.append(Object.assign(document.createElement('li'), { textContent: id }));
  });
  return () => { canvas.removeEventListener('pointermove', onMove); viewer.clearAnnotations(); };
}
