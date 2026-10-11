import { DataLayer, MultiLayerNeuroSurface } from '@src/index.js';
import type { SurfacePickEvent } from '@src/index.js';
import excerpt from '../excerpts/inspect.ts?raw';
import { action, actions, choice, fmt, note, readout, section, toggle } from '../kit/controls';
import { FOCI, addFields, blobField, CURVATURE_UNDERLAY, curvatureOf, loadBilateral, mirror, smoothNoise } from '../kit/data';
import { createFilmViewer } from '../kit/film';
import type { Scenario } from '../types';
import './inspect.css';

type SurfaceId = 'lh' | 'rh';

/** Chinagraph yellow (--mark) for the user's marks and pinned selection; ink for the moving cursor. */
const MARK = 0xf2c230;
/** Marks keep one colour whether or not they are the active mark. */
const MARK_STYLE = { radius: 1.8, colorOn: MARK, colorOff: MARK };
const CURSOR = 0xedf2f5;
const CROSSHAIR_SIZE = 5;

function contrast(vertices: Float32Array, side: 'left' | 'right'): Float32Array {
  const at = (point: readonly [number, number, number]) => (side === 'left' ? point : mirror(point));
  const signal = blobField(vertices, [
    { center: at(FOCI.intraparietal), amplitude: 4.4, sigma: 12 },
    { center: at(FOCI.inferiorFrontal), amplitude: side === 'left' ? 3.8 : 2.2, sigma: 10 },
    { center: at(FOCI.primaryVisual), amplitude: 3.2, sigma: 12 },
    { center: at(FOCI.medialPrefrontal), amplitude: -3.1, sigma: 12 }
  ]);
  return addFields(signal, smoothNoise(vertices, side === 'left' ? 71 : 72, 0.8, 30));
}

interface Mark {
  id: string;
  label: string;
  surfaceId: SurfaceId;
  vertex: number;
  value: number;
}

export const inspect: Scenario = {
  id: 'inspect',
  aliases: ['gpupicking'],
  title: 'Inspect & annotate',
  short: 'Inspect',
  group: 'surfaces',
  tags: ['picking', 'gpu picking', 'crosshair', 'annotations', 'inspection'],
  summary:
    'Both fsaverage5 hemispheres with one data layer, for reading values off the cortex. Hover to pick a vertex (with the GPU picker or CPU raycasting) and read its index, value and coordinates; the margin times each pick. A crosshair follows the cursor; a click pins it as the selection and drops a labelled mark there. Marks are listed in the margin, where you can return to, remove or clear them.',
  synthetic:
    'The map is a constructed contrast (Gaussian effects at intraparietal, inferior frontal, visual and medial prefrontal foci, plus smooth noise), not a result.',
  excerpt,
  run: async ctx => {
    ctx.setBusy(true, 'Loading fsaverage5 hemispheres');
    const { viewer, cleanup } = createFilmViewer(ctx.mount, {
      hoverCrosshair: true,
      hoverCrosshairColor: CURSOR,
      hoverCrosshairSize: CROSSHAIR_SIZE
    });
    const { left, right } = await loadBilateral();
    const geometries = { lh: left, rh: right };
    const values = { lh: contrast(left.vertices, 'left'), rh: contrast(right.vertices, 'right') };
    for (const [id, geometry, hemisphere, mesh] of [
      ['lh', left, 'left', 'fsaverage5Left'],
      ['rh', right, 'right', 'fsaverage5Right']
    ] as const) {
      const surface = new MultiLayerNeuroSurface(geometry, {
        curvature: curvatureOf(mesh, geometry),
        showCurvature: true,
        curvatureOptions: CURVATURE_UNDERLAY
      });
      surface.hemisphere = hemisphere;
      viewer.addSurface(surface, id);
      viewer.addLayer(id, new DataLayer('map', values[id], null, 'coolwarm', {
        range: [-5, 5],
        threshold: [-1.5, 1.5],
        presentation: { label: 'Synthetic contrast', units: 'z' }
      }));
    }
    viewer.registerBilateralSurfaceGroup({ id: 'cortex', leftSurfaceId: 'lh', rightSurfaceId: 'rh' });
    viewer.setAnatomicalView('lateral', { layout: 'paired', groupId: 'cortex', fit: true });
    viewer.fitToView({ padding: 0.05 });

    const film = ctx.film;
    film.trackOrientation(viewer);
    film.set('tl', 'surface', 'Surface', 'fsaverage5 pial, L + R');
    film.set('tr', 'layer', 'Layer', 'Synthetic contrast (z)');

    // ── picking ──
    const stats = { count: 0, total: 0 };
    const gpuAvailable = viewer.enableGPUPicking();
    viewer.getGPUPicker()?.setThrottleMs(0);
    let useGPU = gpuAvailable;
    const pickSection = section(ctx.panel, 'Picking');
    const pickerChoice = choice(pickSection, {
      id: 'inspect-picker',
      label: 'Picker',
      options: [
        { value: 'gpu', label: 'GPU (ID buffer)' },
        { value: 'cpu', label: 'CPU (raycast)' }
      ] as const,
      value: useGPU ? 'gpu' : 'cpu',
      print: { film, corner: 'tr', key: 'picker', label: 'Picker' },
      onChange: next => {
        // The choice drives every pick: the timed pick below and the viewer's own hover and click.
        useGPU = next === 'gpu' && gpuAvailable;
        if (useGPU) viewer.enableGPUPicking();
        else viewer.disableGPUPicking();
        if (next === 'gpu' && !gpuAvailable) {
          pickerChoice.set('cpu');
          unsupported.hidden = false;
        }
        stats.count = 0;
        stats.total = 0;
        countReadout.set('0');
        meanReadout.set('—');
        lastReadout.set('—');
        film.set('bl', 'pick', 'Pick', '—');
      }
    });
    const unsupported = note(pickSection, 'GPU picking is not available in this browser; picks use CPU raycasting.');
    unsupported.hidden = useGPU;
    const countReadout = readout(pickSection, 'Picks', 'inspect-pick-count');
    const meanReadout = readout(pickSection, 'Mean pick time', 'inspect-pick-mean');
    const lastReadout = readout(pickSection, 'Last pick', 'inspect-pick-last');
    countReadout.set('0');
    meanReadout.set('—');
    lastReadout.set('—');

    const canvas = viewer.renderer.domElement;
    const onMove = (event: PointerEvent) => {
      const start = performance.now();
      const hit = viewer.pick({ x: event.clientX, y: event.clientY });
      const elapsed = performance.now() - start;
      stats.count++;
      stats.total += elapsed;
      countReadout.set(stats.count.toLocaleString('en-US'));
      meanReadout.set(`${fmt(stats.total / stats.count, 3)} ms`);
      lastReadout.set(`${fmt(elapsed, 3)} ms${hit.vertexIndex === null ? ' (miss)' : ''}`);
      film.set('bl', 'pick', 'Pick', `${fmt(elapsed, 2)} ms ${useGPU ? 'GPU' : 'CPU'}`);
      printHit(hit.surfaceId as SurfaceId | null, hit.vertexIndex);
    };

    // ── crosshair ──
    const crosshairSection = section(ctx.panel, 'Crosshair');
    toggle(crosshairSection, {
      id: 'inspect-hover-crosshair',
      label: 'Crosshair follows the cursor',
      checked: true,
      onChange: enabled => {
        viewer.updateConfig({ hoverCrosshair: enabled });
        if (!enabled && !pinned) viewer.hideCrosshair();
      }
    });
    note(crosshairSection, 'A click pins the crosshair as the selection; the cursor crosshair resumes once you release it.');
    const crosshairRow = actions(crosshairSection);
    const release = action(crosshairRow, {
      id: 'inspect-release',
      label: 'Release selection',
      onClick: () => {
        pinned = null;
        viewer.hideCrosshair();
        release.disabled = true;
        film.set('br', 'selected', 'Selected', '—');
        renderMarks();
      }
    });
    release.disabled = true;

    // ── marks ──
    const marks: Mark[] = [];
    let activeMark: string | null = null;
    let pinned: { surfaceId: SurfaceId; vertex: number } | null = null;
    let placing = true;
    let nextNumber = 1;
    const markSection = section(ctx.panel, 'Marks');
    toggle(markSection, {
      id: 'inspect-mark-on',
      label: 'Clicks place marks',
      checked: true,
      onChange: enabled => { placing = enabled; }
    });
    const labelRow = document.createElement('div');
    labelRow.className = 'control inspect-label';
    const labelText = document.createElement('label');
    labelText.htmlFor = 'inspect-mark-label';
    labelText.textContent = 'Label for the next mark';
    const labelInput = document.createElement('input');
    labelInput.type = 'text';
    labelInput.id = 'inspect-mark-label';
    labelInput.maxLength = 24;
    labelInput.autocomplete = 'off';
    labelInput.placeholder = 'M1';
    labelRow.append(labelText, labelInput);
    markSection.append(labelRow);
    const list = document.createElement('ol');
    list.className = 'inspect-marks';
    list.id = 'inspect-marks';
    list.setAttribute('aria-label', 'Marks');
    markSection.append(list);
    const empty = note(markSection, 'No marks yet. Click the cortex to place one.');
    const markRow = actions(markSection);
    const clearMarks = action(markRow, {
      id: 'inspect-clear-marks',
      label: 'Clear marks',
      onClick: () => {
        viewer.clearAnnotations();
        marks.length = 0;
        activeMark = null;
        nextNumber = 1;
        labelInput.placeholder = 'M1';
        renderMarks();
        ctx.status('Marks cleared');
      }
    });

    const pin = (surfaceId: SurfaceId, vertex: number) => {
      pinned = { surfaceId, vertex };
      viewer.showCrosshair(surfaceId, vertex, { mode: 'selection', color: MARK, size: CROSSHAIR_SIZE });
      release.disabled = false;
      film.set('br', 'selected', 'Selected', `${surfaceId.toUpperCase()} ${vertex}`);
    };

    function renderMarks() {
      const items = marks.map(mark => {
        const item = document.createElement('li');
        item.dataset.markId = mark.id;
        if (mark.id === activeMark) item.setAttribute('aria-current', 'true');
        const text = document.createElement('span');
        text.className = 'inspect-mark-text';
        const name = document.createElement('strong');
        name.textContent = mark.label;
        const where = document.createElement('span');
        where.className = 'inspect-mark-data';
        where.textContent = `${mark.surfaceId.toUpperCase()} ${mark.vertex} · ${fmt(mark.value)} z`;
        text.append(name, where);
        const go = document.createElement('button');
        go.type = 'button';
        go.className = 'action';
        go.textContent = 'Select';
        go.setAttribute('aria-label', `Select ${mark.label}`);
        go.addEventListener('click', () => {
          activeMark = mark.id;
          viewer.activateAnnotation(mark.id);
          pin(mark.surfaceId, mark.vertex);
          renderMarks();
        });
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'action';
        remove.textContent = 'Remove';
        remove.setAttribute('aria-label', `Remove ${mark.label}`);
        remove.addEventListener('click', () => {
          viewer.removeAnnotation(mark.id);
          marks.splice(marks.indexOf(mark), 1);
          if (activeMark === mark.id) activeMark = null;
          renderMarks();
        });
        item.append(text, go, remove);
        return item;
      });
      list.replaceChildren(...items);
      list.hidden = marks.length === 0;
      empty.hidden = marks.length > 0;
      clearMarks.disabled = marks.length === 0;
      film.set('br', 'marks', 'Marks', String(marks.length));
    }
    renderMarks();

    // A click that ends a drag (camera rotation) is not a selection.
    let downAt: { x: number; y: number } | null = null;
    let dragged = false;
    const onDown = (event: PointerEvent) => { downAt = { x: event.clientX, y: event.clientY }; dragged = false; };
    const onUp = (event: PointerEvent) => {
      if (downAt) dragged = Math.hypot(event.clientX - downAt.x, event.clientY - downAt.y) > 4;
      downAt = null;
    };
    const onClick = (event: SurfacePickEvent) => {
      const id = event.surfaceId as SurfaceId | null;
      if (!id || event.vertexIndex === null || !(id in values)) return;
      if (dragged) {
        // The viewer pins a crosshair on every click; put back what was pinned before the drag.
        const previous = pinned;
        queueMicrotask(() => {
          if (previous) pin(previous.surfaceId, previous.vertex);
          else viewer.hideCrosshair();
        });
        return;
      }
      pin(id, event.vertexIndex);
      if (!placing) {
        ctx.status(`Selected ${id.toUpperCase()} ${event.vertexIndex}`);
        return;
      }
      const label = labelInput.value.trim() || `M${nextNumber}`;
      const markId = viewer.addAnnotation(id, event.vertexIndex, { label }, MARK_STYLE);
      if (!markId) return;
      nextNumber++;
      labelInput.value = '';
      labelInput.placeholder = `M${nextNumber}`;
      marks.push({ id: markId, label, surfaceId: id, vertex: event.vertexIndex, value: values[id][event.vertexIndex]! });
      activeMark = markId;
      viewer.activateAnnotation(markId);
      renderMarks();
      ctx.status(`Marked ${label} at ${id.toUpperCase()} ${event.vertexIndex}`);
    };

    /** The readout follows the chosen picker's own result, so CPU and GPU can be compared. */
    function printHit(id: SurfaceId | null, vertexIndex: number | null) {
      if (!id || vertexIndex === null || !(id in values)) {
        film.set('br', 'vertex', 'Vertex', '—');
        film.set('br', 'value', 'Value', '—');
        film.set('br', 'ras', 'RAS', '—');
        return;
      }
      const info = viewer.inspectVertex(id, vertexIndex);
      const value = info?.values.find(entry => entry.layerId === 'map')?.value;
      const v = vertexIndex * 3;
      const native = geometries[id].vertices;
      film.set('br', 'vertex', 'Vertex', `${id.toUpperCase()} ${vertexIndex}`);
      film.set('br', 'value', 'Value', typeof value === 'number' ? `${fmt(value)} z` : '—');
      film.set('br', 'ras', 'RAS', [native[v]!, native[v + 1]!, native[v + 2]!].map(c => fmt(c, 1)).join(' '));
    }

    const onLeave = () => printHit(null, null);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerleave', onLeave);
    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointerup', onUp);
    viewer.on('surface:click', onClick);
    printHit(null, null);
    film.set('br', 'selected', 'Selected', '—');

    const vertexCount = (left.vertices.length + right.vertices.length) / 3;
    ctx.perf(`${vertexCount.toLocaleString('en-US')} vertices`);
    ctx.setBusy(false);
    return () => {
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerleave', onLeave);
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointerup', onUp);
      viewer.off('surface:click', onClick);
      viewer.clearAnnotations();
      cleanup();
    };
  }
};
