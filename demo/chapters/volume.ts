import { addRibbonColumns } from '../kit/surface-geometry';
import { DataLayer, MultiLayerNeuroSurface, THREE, VolumeProjectionLayer, VolumeTexture3D, projectVolume } from '@src/index.js';
import type { AnatomicalView, VolumeDescriptor } from '@src/index.js';
import excerpt from '../excerpts/volume.ts?raw';
import { choice, fmt, note, readout, section, select, slider } from '../kit/controls';
import { CURVATURE_UNDERLAY, FOCI, addFields, blobField, curvatureOf, loadMesh, smoothNoise } from '../kit/data';
import { createFilmViewer } from '../kit/film';
import type { Scenario } from '../types';
import './volume.css';

type Method = 'normals' | 'layer';
type ProjectionMode = 'vertex' | 'fragment' | 'hybrid' | 'ribbon';
type Sampling = 'nearest' | 'linear';
type Quality = 'interactive' | 'publication';
type RibbonReducer = 'mean' | 'max' | 'min' | 'median';
type Reducer = 'mean' | 'max-abs';

const VOXEL_MM = 2;
const MARGIN_MM = 14;
/** Cortical thickness assumed for the synthetic white surface. */
const RIBBON_MM = 2.5;

const VIEWS: ReadonlyArray<{ value: AnatomicalView; label: string }> = [
  { value: 'lateral', label: 'Lateral' },
  { value: 'medial', label: 'Medial' },
  { value: 'dorsal', label: 'Dorsal' },
  { value: 'ventral', label: 'Ventral' }
];

const CUSTOM_SIGNED = ['#163b9d', '#ffffff', '#b02125'];
const palette = (name: string) => name === 'custom-signed' ? CUSTOM_SIGNED : name;

const COLORMAPS = [
  { value: 'custom-signed', label: 'Custom signed palette' },
  { value: 'coolwarm', label: 'Cool–warm (diverging)' },
  { value: 'seismic', label: 'Seismic (diverging)' },
  { value: 'RdBu', label: 'Red–blue' },
  { value: 'viridis', label: 'Viridis' }
] as const;

/** Area-weighted vertex normals, oriented outward (away from the mesh centroid on average). */
function outwardNormals(vertices: Float32Array, faces: Uint32Array): Float32Array {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
  geometry.setIndex(new THREE.BufferAttribute(faces, 1));
  geometry.computeVertexNormals();
  const normals = (geometry.getAttribute('normal').array as Float32Array).slice();
  geometry.dispose();
  const count = vertices.length / 3;
  const centroid = [0, 0, 0];
  for (let v = 0; v < count; v++) for (let a = 0; a < 3; a++) centroid[a]! += vertices[v * 3 + a]! / count;
  let alignment = 0;
  for (let v = 0; v < count; v++) {
    for (let a = 0; a < 3; a++) alignment += normals[v * 3 + a]! * (vertices[v * 3 + a]! - centroid[a]!);
  }
  if (alignment < 0) for (let i = 0; i < normals.length; i++) normals[i] = -normals[i]!;
  return normals;
}

/**
 * One synthetic scalar volume on a 2 mm grid that covers the hemisphere with a margin,
 * in the mesh's own RAS millimetre frame. Voxel (i, j, k) has its centre at
 * origin + 2·(i, j, k); the affine says exactly that.
 */
function syntheticVolume(vertices: Float32Array): VolumeDescriptor & { dims: [number, number, number]; voxelToWorld: number[]; data: Float32Array } {
  const low = [Infinity, Infinity, Infinity], high = [-Infinity, -Infinity, -Infinity];
  for (let v = 0; v < vertices.length; v += 3) {
    for (let a = 0; a < 3; a++) {
      low[a] = Math.min(low[a]!, vertices[v + a]!);
      high[a] = Math.max(high[a]!, vertices[v + a]!);
    }
  }
  const origin = low.map(value => Math.floor(value - MARGIN_MM)) as [number, number, number];
  const dims = high.map((value, a) => Math.ceil((value + MARGIN_MM - origin[a]!) / VOXEL_MM) + 1) as [number, number, number];
  const total = dims[0] * dims[1] * dims[2];
  const centres = new Float32Array(total * 3);
  for (let k = 0, n = 0; k < dims[2]; k++) {
    for (let j = 0; j < dims[1]; j++) {
      for (let i = 0; i < dims[0]; i++, n++) {
        centres[n * 3] = origin[0] + VOXEL_MM * i;
        centres[n * 3 + 1] = origin[1] + VOXEL_MM * j;
        centres[n * 3 + 2] = origin[2] + VOXEL_MM * k;
      }
    }
  }
  const deep = (point: readonly [number, number, number], mm: number): [number, number, number] => [point[0] + mm, point[1], point[2]];
  const effects = blobField(centres, [
    { center: FOCI.primaryVisual, amplitude: 4.2, sigma: 8 },
    { center: FOCI.motorHand, amplitude: 3.6, sigma: 7 },
    // Centred 8 mm medial of the auditory focus: strongest below the surface.
    { center: deep(FOCI.auditory, 8), amplitude: 3.4, sigma: 6 },
    { center: FOCI.inferiorFrontal, amplitude: -3.2, sigma: 7 },
    { center: FOCI.posteriorCingulate, amplitude: -2.8, sigma: 8 }
  ]);
  const data = addFields(effects, smoothNoise(centres, 61, 1.1, 14));
  const voxelToWorld = [
    VOXEL_MM, 0, 0, 0,
    0, VOXEL_MM, 0, 0,
    0, 0, VOXEL_MM, 0,
    origin[0], origin[1], origin[2], 1
  ];
  return { data, dims, voxelToWorld };
}

export const volume: Scenario = {
  id: 'volume',
  aliases: ['volume-projection', 'normal-projection'],
  title: 'Volume to surface',
  short: 'Volume',
  group: 'surfaces',
  tags: ['projectVolume', 'VolumeProjectionLayer', 'surface normals', 'ribbon sampling', 'WebGL2 3D texture', 'column integration', 'coverage'],
  summary:
    'Map a synthetic 2 mm volume onto the fsaverage5 left pial surface. Compare normal sampling with GPU volume layers, then inspect a white–pial column: its volume-weighted mean, segment-sampled mean, and valid-volume coverage are reported separately. Choose an example column or click the cortex; the marker shows which vertex was measured.',
  synthetic:
    'The volume is constructed: Gaussian effects at visual, motor, deep auditory, inferior frontal and posterior cingulate foci plus smooth 3D noise (14 mm wavelength). The white surface for ribbon mode is the pial surface moved 2.5 mm inward along its normals, not a real white-matter surface.',
  excerpt,
  run: async ctx => {
    ctx.setBusy(true, 'Loading fsaverage5 left pial surface');
    const { viewer, cleanup } = createFilmViewer(ctx.mount);
    const geometry = await loadMesh('fsaverage5Left');
    const positions = geometry.vertices.slice();
    const normals = outwardNormals(positions, geometry.faces);
    const vertexCount = positions.length / 3;
    const pial = positions;
    const white = new Float32Array(positions.length);
    for (let i = 0; i < white.length; i++) white[i] = positions[i]! - RIBBON_MM * normals[i]!;
    const vol = syntheticVolume(positions);

    // GPU compositing where WebGL2 allows it: VolumeProjectionLayer's vertex mode then samples
    // the volume as a 3D texture in the vertex shader. The GPU material is lit like the CPU one.
    const webgl2 = viewer.capabilities.webgl2 && VolumeTexture3D.isSupported(viewer.renderer, { requireLinearFiltering: false });
    const floatLinear = webgl2 && VolumeTexture3D.supportsLinearFiltering(viewer.renderer);
    const surface = new MultiLayerNeuroSurface(geometry, {
      useGPUCompositing: webgl2,
      curvature: curvatureOf('fsaverage5Left', geometry),
      showCurvature: true,
      curvatureOptions: CURVATURE_UNDERLAY
    });
    surface.hemisphere = 'left';
    viewer.addSurface(surface, 'lh');
    viewer.setAnatomicalView('lateral', { layout: 'single', surfaceId: 'lh', fit: true });
    viewer.fitToView({ padding: 0.05 });

    const state = {
      method: 'normals' as Method,
      low: -4, high: 4, steps: 5,
      interpolation: 'linear' as Sampling,
      reducer: 'mean' as Reducer,
      projectionMode: 'vertex' as ProjectionMode,
      sampling: 'linear' as Sampling,
      quality: 'interactive' as Quality,
      ribbonSamples: 7,
      ribbonReducer: 'mean' as RibbonReducer,
      colormap: 'coolwarm' as string,
      window: 4,
      threshold: 0.5
    };
    const range = (): [number, number] => [-state.window, state.window];
    const threshold = (): [number, number] => [-state.threshold, state.threshold];

    const film = ctx.film;
    film.trackOrientation(viewer);
    film.set('tl', 'surface', 'Surface', 'fsaverage5 pial, L');
    film.set('tl', 'volume', 'Volume', `${vol.dims.join(' × ')} @ ${VOXEL_MM} mm`);

    // ── (a) projectVolume along normals → DataLayer
    let projected: { values: Float32Array; validSamples: Uint32Array } | null = null;
    let projectedLayer: DataLayer | null = null;
    const resultReadout = { set: (_: string) => {} };
    const project = () => {
      const start = performance.now();
      projected = projectVolume(vol, { positions, normals }, {
        depthMm: [state.low, state.high],
        steps: state.steps,
        interpolation: state.interpolation,
        reducer: state.reducer
      });
      const elapsed = performance.now() - start;
      if (projectedLayer) projectedLayer.setData(projected.values);
      else {
        projectedLayer = new DataLayer('projected', projected.values, null, palette(state.colormap), {
          range: range(), threshold: threshold(),
          presentation: { label: 'Projected volume (synthetic)' }
        });
        viewer.addLayer('lh', projectedLayer);
      }
      let valid = 0;
      for (const count of projected.validSamples) if (count > 0) valid++;
      resultReadout.set(`${valid.toLocaleString('en-US')} / ${vertexCount.toLocaleString('en-US')} vertices; depths [${state.low}, ${state.high}] mm; ${state.steps} samples; ${state.reducer}; ${fmt(elapsed, 1)} ms`);
      film.set('tr', 'method', 'Method', `projectVolume, ${state.reducer}`);
    };

    // ── (b) VolumeProjectionLayer
    let volumeLayer: VolumeProjectionLayer | null = null;
    const pathReadout = { set: (_: string) => {} };
    const describePath = () => {
      const resolved = state.projectionMode === 'hybrid'
        ? (state.quality === 'publication' ? 'ribbon' : 'vertex')
        : state.projectionMode;
      const gpu = surface.getCompositingMode() === 'GPU';
      let text: string;
      if (resolved === 'vertex' && gpu) {
        // Float 3D textures filter linearly only with OES_texture_float_linear; the library
        // falls back to nearest without it.
        text = state.sampling === 'linear' && !floatLinear
          ? 'GPU 3D texture, nearest (no float linear filtering)'
          : `GPU 3D texture, ${state.sampling}`;
      } else if (resolved === 'vertex') {
        text = `CPU per vertex, ${state.sampling}`;
      } else if (resolved === 'ribbon') {
        text = `CPU ribbon, ${state.ribbonSamples} samples white→pial, ${state.ribbonReducer}`;
      } else {
        text = `CPU per vertex, ${state.sampling} (per-pixel sampling: VolumeProjectedSurface)`;
      }
      const prefix = state.projectionMode === 'hybrid' ? `hybrid → ${resolved}: ` : '';
      pathReadout.set(prefix + text);
      film.set('tr', 'method', 'Method', `VolumeProjectionLayer, ${state.projectionMode}`);
    };
    const ensureVolumeLayer = () => {
      if (volumeLayer) return volumeLayer;
      volumeLayer = new VolumeProjectionLayer('volume', vol.data, vol.dims, {
        affineMatrix: vol.voxelToWorld,
        colormap: palette(state.colormap),
        range: range(),
        threshold: threshold(),
        fillValue: -1e6, // no voxel holds this value, so nothing is masked as fill
        projectionMode: state.projectionMode,
        sampling: state.sampling,
        quality: state.quality,
        ribbon: { pial, white, samples: state.ribbonSamples, reducer: state.ribbonReducer }
      });
      viewer.addLayer('lh', volumeLayer);
      return volumeLayer;
    };
    const updateVolumeLayer = () => {
      if (!volumeLayer) return;
      viewer.updateLayer('lh', 'volume', {
        projectionMode: state.projectionMode,
        sampling: state.sampling,
        quality: state.quality,
        ribbon: { samples: state.ribbonSamples, reducer: state.ribbonReducer }
      });
      describePath();
    };

    const activeLayerId = () => (state.method === 'normals' ? 'projected' : 'volume');
    const updateDisplay = (changes: Record<string, unknown>) => {
      for (const id of ['projected', 'volume']) {
        if (surface.getLayer(id)) viewer.updateLayer('lh', id, changes);
      }
    };

    // ── Margin
    const methodSection = section(ctx.panel, 'Method');
    choice(methodSection, {
      id: 'volume-method',
      label: 'Projection',
      options: [
        { value: 'normals', label: 'Sample along normals' },
        { value: 'layer', label: 'Volume layer' }
      ],
      value: 'normals',
      onChange: next => setMethod(next)
    });
    choice(methodSection, {
      id: 'volume-view',
      label: 'Anatomical view',
      options: VIEWS,
      value: 'lateral',
      print: { film, corner: 'tr', key: 'view', label: 'View' },
      onChange: next => {
        viewer.setAnatomicalView(next, { layout: 'single', surfaceId: 'lh', fit: true });
        viewer.fitToView({ padding: 0.05 });
      }
    });

    const normalsSection = section(ctx.panel, 'Sampling along normals');
    normalsSection.dataset.method = 'normals';
    note(normalsSection, 'Depths are millimetres along each vertex’s outward normal: negative is into the cortex, positive is out towards the skull.');
    slider(normalsSection, {
      id: 'normal-low', label: 'Deepest sample (mm)', min: -12, max: 0, step: 1, value: state.low,
      format: value => `${fmt(value, 0)} mm`,
      print: { film, corner: 'bl', key: 'depth-low', label: 'Depth from' },
      onInput: value => { state.low = value; project(); }
    });
    slider(normalsSection, {
      id: 'normal-high', label: 'Outermost sample (mm)', min: 0, max: 12, step: 1, value: state.high,
      format: value => `${fmt(value, 0)} mm`,
      print: { film, corner: 'bl', key: 'depth-high', label: 'Depth to' },
      onInput: value => { state.high = value; project(); }
    });
    slider(normalsSection, {
      id: 'normal-steps', label: 'Samples per vertex', min: 1, max: 16, step: 1, value: state.steps,
      onInput: value => { state.steps = value; project(); }
    });
    select(normalsSection, {
      id: 'normal-interpolation', label: 'Interpolation',
      options: [{ value: 'linear', label: 'Linear (voxel centres)' }, { value: 'nearest', label: 'Nearest voxel' }],
      value: state.interpolation,
      onChange: next => { state.interpolation = next; project(); }
    });
    select(normalsSection, {
      id: 'normal-reducer', label: 'Reduction across depth',
      options: [{ value: 'mean', label: 'Mean' }, { value: 'max-abs', label: 'Signed maximum absolute' }],
      value: state.reducer,
      onChange: next => { state.reducer = next; project(); }
    });
    const result = readout(normalsSection, 'Result', 'normal-result');
    result.element.setAttribute('role', 'status');
    resultReadout.set = result.set;

    const layerSection = section(ctx.panel, 'Volume layer');
    layerSection.dataset.method = 'layer';
    note(layerSection, surface.getCompositingMode() === 'GPU'
      ? 'Composited on the GPU here (useGPUCompositing, WebGL2): vertex mode samples the volume as a 3D texture in the vertex shader, nearest or linear between voxel centres. Fragment and ribbon modes are sampled on the CPU per vertex.'
      : 'WebGL2 is not available in this browser, so there is no 3D texture path: every mode is sampled on the CPU per vertex.');
    select(layerSection, {
      id: 'volume-mode', label: 'Projection mode',
      options: [
        { value: 'vertex', label: 'Vertex' },
        { value: 'fragment', label: 'Fragment' },
        { value: 'hybrid', label: 'Hybrid (by quality)' },
        { value: 'ribbon', label: 'Ribbon (white to pial)' }
      ],
      value: state.projectionMode,
      onChange: next => { state.projectionMode = next; updateVolumeLayer(); }
    });
    select(layerSection, {
      id: 'volume-sampling', label: 'Sampling',
      options: [{ value: 'linear', label: 'Linear' }, { value: 'nearest', label: 'Nearest' }],
      value: state.sampling,
      onChange: next => { state.sampling = next; updateVolumeLayer(); }
    });
    choice(layerSection, {
      id: 'volume-quality', label: 'Quality',
      options: [{ value: 'interactive', label: 'Interactive' }, { value: 'publication', label: 'Publication' }],
      value: state.quality,
      onChange: next => { state.quality = next; updateVolumeLayer(); }
    });
    slider(layerSection, {
      id: 'volume-ribbon-samples', label: 'Ribbon samples', min: 1, max: 15, step: 2, value: state.ribbonSamples,
      onInput: value => { state.ribbonSamples = value; updateVolumeLayer(); }
    });
    select(layerSection, {
      id: 'volume-ribbon-reducer', label: 'Ribbon reduction',
      options: [
        { value: 'mean', label: 'Mean' }, { value: 'max', label: 'Maximum' },
        { value: 'min', label: 'Minimum' }, { value: 'median', label: 'Median' }
      ],
      value: state.ribbonReducer,
      onChange: next => { state.ribbonReducer = next; updateVolumeLayer(); }
    });
    const path = readout(layerSection, 'Sampling path', 'volume-path');
    pathReadout.set = path.set;

    const display = section(ctx.panel, 'Display');
    select(display, {
      id: 'volume-colormap', label: 'Colormap', options: COLORMAPS, value: 'coolwarm',
      print: { film, corner: 'tr', key: 'colormap', label: 'Colormap' },
      onChange: next => { state.colormap = next; updateDisplay({ colorMap: palette(next) }); }
    });
    slider(display, {
      id: 'volume-window', label: 'Colour window (±)', min: 1, max: 8, step: 0.5, value: state.window,
      format: value => `±${fmt(value, 1)}`,
      print: { film, corner: 'bl', key: 'window', label: 'Window' },
      onInput: value => { state.window = value; updateDisplay({ range: range() }); }
    });
    slider(display, {
      id: 'volume-threshold', label: 'Hide values within (±)', min: 0, max: 3, step: 0.1, value: state.threshold,
      format: value => (value === 0 ? 'off' : `±${fmt(value, 1)}`),
      print: { film, corner: 'bl', key: 'threshold', label: 'Threshold' },
      onInput: value => { state.threshold = value; updateDisplay({ threshold: threshold() }); }
    });

    const setMethod = (next: Method) => {
      state.method = next;
      for (const element of [normalsSection, layerSection]) element.hidden = element.dataset.method !== next;
      if (next === 'layer') {
        ensureVolumeLayer();
        describePath();
      } else {
        film.set('tr', 'method', 'Method', `projectVolume, ${state.reducer}`);
      }
      viewer.updateLayerVisibility('lh', 'projected', next === 'normals');
      if (volumeLayer) viewer.updateLayerVisibility('lh', 'volume', next === 'layer');
      film.set('bl', 'depth-low', 'Depth from', next === 'normals' ? `${state.low} mm` : null);
      film.set('bl', 'depth-high', 'Depth to', next === 'normals' ? `${state.high} mm` : null);
      onHover({ surfaceId: null, vertexIndex: null });
    };

    const onHover = (event: { surfaceId: string | null; vertexIndex: number | null }) => {
      const v = event.vertexIndex;
      if (event.surfaceId !== 'lh' || v === null) {
        film.set('br', 'cursor', 'Vertex', '—');
        film.set('br', 'value', 'Value', '—');
        film.set('br', 'samples', 'Valid', null);
        return;
      }
      film.set('br', 'cursor', 'Vertex', `L ${v}`);
      if (activeLayerId() === 'projected' && projected) {
        const value = projected.values[v]!;
        film.set('br', 'value', 'Value', Number.isFinite(value) ? fmt(value, 2) : 'no samples');
        film.set('br', 'samples', 'Valid', `${projected.validSamples[v]} of ${state.steps}`);
      } else if (volumeLayer) {
        const value = volumeLayer.sampleValueAtVertex(v);
        film.set('br', 'value', 'Value', value === null ? 'outside volume' : fmt(value, 2));
        film.set('br', 'samples', 'Valid', null);
      }
    };
    viewer.on('vertex:hover', onHover);

    project();
    setMethod('normals');
    ctx.perf(`${vertexCount.toLocaleString('en-US')} vertices · ${(vol.data.length).toLocaleString('en-US')} voxels · ${surface.getCompositingMode()} compositing`);
    ctx.setBusy(false);
    const removeColumns = addRibbonColumns(ctx, viewer, geometry, white, pial, vol);
    return () => {
      removeColumns();
      viewer.off('vertex:hover', onHover);
      cleanup();
      volumeLayer?.dispose();
    };
  }
};
