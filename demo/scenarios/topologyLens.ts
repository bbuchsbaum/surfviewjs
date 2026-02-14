import {
  MultiLayerNeuroSurface,
  SurfaceGeometry,
  ParcelValueLayer,
  OutlineLayer,
  THREE,
  type ParcelData,
  type GraphEdge,
  buildAdjacency,
  computeNeighborhoodShells,
  resolveBoundaryStyles,
  createDifferenceEdgeMetric,
  createOpacityQualityChannel,
  createPatternQualityChannel,
  mapQualityChannelValue
} from '@src/index.js';
import { createViewer } from '../viewerHarness';
import type { Scenario, ScenarioRunContext } from '../types';

interface BoundarySegment {
  pairKey: string;
  sourceParcel: number;
  targetParcel: number;
  ax: number;
  ay: number;
  az: number;
  bx: number;
  by: number;
  bz: number;
}

interface ParcelMaps {
  valueByParcel: Map<number, number>;
  confidenceByParcel: Map<number, number>;
}

function makeSphere(detail = 72): SurfaceGeometry {
  const geo = new THREE.SphereGeometry(55, detail, detail);
  const vertices = new Float32Array(geo.attributes.position.array);
  const faces = new Uint32Array(geo.index?.array || []);
  return new SurfaceGeometry(vertices, faces, 'topology');
}

function buildSyntheticParcellation(
  vertices: Float32Array,
  latBins: number,
  lonBins: number
): { vertexLabels: Uint32Array; parcelCount: number } {
  const V = vertices.length / 3;
  const labels = new Uint32Array(V);

  for (let i = 0; i < V; i++) {
    const x = vertices[i * 3];
    const y = vertices[i * 3 + 1];
    const z = vertices[i * 3 + 2];
    const r = Math.sqrt(x * x + y * y + z * z) || 1;

    const theta = Math.acos(Math.max(-1, Math.min(1, y / r))); // [0, pi]
    let phi = Math.atan2(z, x); // [-pi, pi]
    if (phi < 0) {
      phi += Math.PI * 2;
    }

    const lat = Math.min(latBins - 1, Math.floor((theta / Math.PI) * latBins));
    const lon = Math.min(lonBins - 1, Math.floor((phi / (Math.PI * 2)) * lonBins));
    labels[i] = lat * lonBins + lon + 1;
  }

  return { vertexLabels: labels, parcelCount: latBins * lonBins };
}

function makeParcelData(parcelCount: number, latBins: number, lonBins: number, phase: number): ParcelData {
  const parcels = [] as ParcelData['parcels'];

  for (let id = 1; id <= parcelCount; id++) {
    const index = id - 1;
    const lat = Math.floor(index / lonBins);
    const lon = index % lonBins;

    const latNorm = (lat + 0.5) / latBins;
    const lonNorm = (lon + 0.5) / lonBins;

    const value =
      0.85 * Math.sin((latNorm + phase) * Math.PI * 2) +
      0.7 * Math.cos((lonNorm - phase * 0.5) * Math.PI * 2);

    const confidence = Math.max(
      0.12,
      Math.min(
        0.98,
        0.35 +
          0.55 * Math.abs(Math.cos((latNorm + 0.17) * Math.PI)) +
          0.1 * Math.sin((lonNorm + phase * 0.2) * Math.PI * 2)
      )
    );

    parcels.push({
      id,
      label: `Parcel ${id}`,
      hemi: lon < lonBins / 2 ? 'left' : 'right',
      value,
      confidence,
      lens: Number.NaN
    });
  }

  return {
    schema_version: '1.0.0',
    atlas: {
      id: 'synthetic-sphere-grid',
      name: 'Synthetic Sphere Grid',
      version: '1',
      n_parcels: parcelCount,
      representation: 'surface',
      space: 'synthetic',
      confidence: 'approximate'
    },
    parcels
  };
}

function extractParcelMaps(parcelData: ParcelData): ParcelMaps {
  const valueByParcel = new Map<number, number>();
  const confidenceByParcel = new Map<number, number>();

  for (const parcel of parcelData.parcels) {
    valueByParcel.set(parcel.id, typeof parcel.value === 'number' ? parcel.value : Number.NaN);
    confidenceByParcel.set(parcel.id, typeof parcel.confidence === 'number' ? parcel.confidence : Number.NaN);
  }

  return { valueByParcel, confidenceByParcel };
}

function buildBoundarySegments(
  vertices: Float32Array,
  faces: Uint32Array,
  vertexLabels: Uint32Array,
  surfaceOffset = 1.01
): { segments: BoundarySegment[]; graphEdges: GraphEdge[] } {
  const segments: BoundarySegment[] = [];
  const seenVertexEdges = new Set<string>();
  const seenParcelPairs = new Set<string>();
  const graphEdges: GraphEdge[] = [];

  const addEdge = (a: number, b: number) => {
    const parcelA = vertexLabels[a];
    const parcelB = vertexLabels[b];
    if (!parcelA || !parcelB || parcelA === parcelB) {
      return;
    }

    const edgeKey = a < b ? `${a}-${b}` : `${b}-${a}`;
    if (seenVertexEdges.has(edgeKey)) {
      return;
    }
    seenVertexEdges.add(edgeKey);

    const sourceParcel = Math.min(parcelA, parcelB);
    const targetParcel = Math.max(parcelA, parcelB);
    const pairKey = `${sourceParcel}-${targetParcel}`;

    if (!seenParcelPairs.has(pairKey)) {
      seenParcelPairs.add(pairKey);
      graphEdges.push({ source: sourceParcel, target: targetParcel });
    }

    const ax = vertices[a * 3] * surfaceOffset;
    const ay = vertices[a * 3 + 1] * surfaceOffset;
    const az = vertices[a * 3 + 2] * surfaceOffset;
    const bx = vertices[b * 3] * surfaceOffset;
    const by = vertices[b * 3 + 1] * surfaceOffset;
    const bz = vertices[b * 3 + 2] * surfaceOffset;

    segments.push({
      pairKey,
      sourceParcel,
      targetParcel,
      ax,
      ay,
      az,
      bx,
      by,
      bz
    });
  };

  for (let i = 0; i < faces.length; i += 3) {
    const a = faces[i];
    const b = faces[i + 1];
    const c = faces[i + 2];

    addEdge(a, b);
    addEdge(b, c);
    addEdge(c, a);
  }

  return { segments, graphEdges };
}

function disposeGroup(group: THREE.Group): void {
  group.traverse(obj => {
    const anyObj = obj as any;
    if (anyObj.geometry && typeof anyObj.geometry.dispose === 'function') {
      anyObj.geometry.dispose();
    }
    if (anyObj.material) {
      if (Array.isArray(anyObj.material)) {
        anyObj.material.forEach((mat: any) => mat?.dispose?.());
      } else if (typeof anyObj.material.dispose === 'function') {
        anyObj.material.dispose();
      }
    }
  });

  while (group.children.length > 0) {
    group.remove(group.children[0]);
  }
}

function updateBoundaryTensionOverlay(
  overlayGroup: THREE.Group,
  boundarySegments: BoundarySegment[],
  pairStyleLookup: Map<string, number>,
  visible: boolean
): void {
  overlayGroup.visible = visible;
  disposeGroup(overlayGroup);
  if (!visible) {
    return;
  }

  const buckets = [
    { max: 0.33, color: 0x4fc3f7, opacity: 0.25 },
    { max: 0.66, color: 0xfacc15, opacity: 0.45 },
    { max: 1.0, color: 0xf97316, opacity: 0.9 }
  ];

  for (const bucket of buckets) {
    const positions: number[] = [];
    for (const segment of boundarySegments) {
      const metric = pairStyleLookup.get(segment.pairKey) ?? 0;
      if (metric > bucket.max) {
        continue;
      }
      const prevMax = bucket.max === 0.33 ? -Infinity : bucket.max === 0.66 ? 0.33 : 0.66;
      if (metric <= prevMax) {
        continue;
      }

      positions.push(
        segment.ax,
        segment.ay,
        segment.az,
        segment.bx,
        segment.by,
        segment.bz
      );
    }

    if (positions.length === 0) {
      continue;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));

    const material = new THREE.LineBasicMaterial({
      color: bucket.color,
      transparent: true,
      opacity: bucket.opacity,
      depthWrite: false
    });

    const lines = new THREE.LineSegments(geometry, material);
    lines.renderOrder = 30;
    overlayGroup.add(lines);
  }
}

function updateLensColumn(parcelData: ParcelData, shells: Map<number, number>, maxHops: number): void {
  for (const parcel of parcelData.parcels) {
    const hop = shells.get(parcel.id);
    if (hop === undefined) {
      parcel.lens = Number.NaN;
      continue;
    }

    parcel.lens = Math.max(0, 1 - hop / Math.max(1, maxHops + 0.3));
  }
}

function clearLensColumn(parcelData: ParcelData): void {
  for (const parcel of parcelData.parcels) {
    parcel.lens = Number.NaN;
  }
}

export const topologyLens: Scenario = {
  id: 'topologyLens',
  title: 'Topology Lens + Quality Channels',
  description:
    'Graph-native region visualization: boundary metrics, neighborhood lens focus, and quality-driven outline channels.',
  tags: ['graph', 'topology', 'parcellation', 'interaction', 'quality'],
  run: async (ctx: ScenarioRunContext) => {
    ctx.status('Building synthetic parcels and graph overlays');

    const mount = document.createElement('div');
    mount.style.width = '100%';
    mount.style.height = '100%';
    ctx.mount.replaceChildren(mount);

    const { viewer, cleanup } = createViewer(mount, {
      showControls: true,
      useControls: false,
      backgroundColor: 0x09111b,
      preset: 'presentation',
      hoverCrosshair: true
    });

    const geometry = makeSphere(72);
    const latBins = 8;
    const lonBins = 12;
    const { vertexLabels, parcelCount } = buildSyntheticParcellation(
      geometry.vertices,
      latBins,
      lonBins
    );

    let phase = 0;
    let maxHops = 2;
    let showTension = true;
    let showQuality = true;
    let selectedParcel: number | null = null;

    let parcelData = makeParcelData(parcelCount, latBins, lonBins, phase);
    const surface = new MultiLayerNeuroSurface(geometry, {
      baseColor: 0x1f2937,
      useGPUCompositing: false
    });
    viewer.addSurface(surface, 'topology');

    const valueLayer = new ParcelValueLayer('parcel-values', parcelData, vertexLabels, 'viridis', {
      valueColumn: 'value',
      range: [-1.8, 1.8],
      opacity: 0.92,
      order: 1
    });
    surface.addLayer(valueLayer);

    const lensLayer = new ParcelValueLayer('neighbor-lens', parcelData, vertexLabels, 'magma', {
      valueColumn: 'lens',
      range: [0, 1],
      opacity: 0.8,
      blendMode: 'additive',
      order: 5
    });
    surface.addLayer(lensLayer);

    const { segments: boundarySegments, graphEdges } = buildBoundarySegments(
      geometry.vertices,
      geometry.faces,
      vertexLabels
    );
    const adjacency = buildAdjacency(graphEdges);

    const tensionGroup = new THREE.Group();
    tensionGroup.name = '__TOPOLOGY_TENSION__';
    surface.mesh?.add(tensionGroup);

    const qualityPattern = createPatternQualityChannel('confidence', 'higher-is-better', [0, 1]);
    const qualityOpacity = createOpacityQualityChannel('confidence', 'higher-is-better', [0, 1]);

    const qualityLow = new OutlineLayer('quality-low', {
      roiLabels: vertexLabels,
      color: 0xf97316,
      width: 2.4,
      opacity: 0.95,
      halo: true,
      haloColor: 0xf59e0b,
      haloWidth: 1.8,
      order: 20
    });
    const qualityMid = new OutlineLayer('quality-mid', {
      roiLabels: vertexLabels,
      color: 0xfacc15,
      width: 1.6,
      opacity: 0.7,
      halo: false,
      order: 19
    });
    const qualityHigh = new OutlineLayer('quality-high', {
      roiLabels: vertexLabels,
      color: 0x38bdf8,
      width: 0.9,
      opacity: 0.45,
      halo: false,
      order: 18
    });

    surface.addLayer(qualityLow);
    surface.addLayer(qualityMid);
    surface.addLayer(qualityHigh);

    const getAutoFocusParcel = (): number => {
      let bestId = 1;
      let bestScore = -Infinity;
      for (const parcel of parcelData.parcels) {
        const value = typeof parcel.value === 'number' ? Math.abs(parcel.value) : Number.NaN;
        if (Number.isFinite(value) && value > bestScore) {
          bestScore = value;
          bestId = parcel.id;
        }
      }
      return bestId;
    };

    const refreshOverlays = () => {
      const { valueByParcel, confidenceByParcel } = extractParcelMaps(parcelData);

      const tensionMetric = createDifferenceEdgeMetric(valueByParcel, { absolute: true });
      const tensionStyles = resolveBoundaryStyles(graphEdges, {
        edgeMetric: tensionMetric,
        metricRange: [0, 2.8]
      });

      const pairMetric = new Map<string, number>();
      for (let i = 0; i < graphEdges.length; i++) {
        const edge = graphEdges[i];
        const key = `${Math.min(edge.source as number, edge.target as number)}-${Math.max(edge.source as number, edge.target as number)}`;
        pairMetric.set(key, tensionStyles[i].normalizedMetric);
      }

      updateBoundaryTensionOverlay(tensionGroup, boundarySegments, pairMetric, showTension);

      const lowIds: number[] = [];
      const midIds: number[] = [];
      const highIds: number[] = [];

      for (let id = 1; id <= parcelCount; id++) {
        const conf = confidenceByParcel.get(id) ?? Number.NaN;
        const pattern = mapQualityChannelValue(conf, qualityPattern).mappedValue as string;
        if (pattern === 'dotted') {
          lowIds.push(id);
        } else if (pattern === 'dashed') {
          midIds.push(id);
        } else {
          highIds.push(id);
        }
      }

      surface.updateLayers([
        { id: 'quality-low', roiSubset: lowIds, visible: showQuality },
        { id: 'quality-mid', roiSubset: midIds, visible: showQuality },
        { id: 'quality-high', roiSubset: highIds, visible: showQuality }
      ]);

      const focusParcel = selectedParcel ?? getAutoFocusParcel();
      const selectedText = selectedParcel
        ? ` | selected parcel ${selectedParcel}`
        : ` | auto focus parcel ${focusParcel}`;
      ctx.status(
        `Parcels: ${parcelCount} | graph edges: ${graphEdges.length}${selectedText}`
      );

      const meanConf = Array.from(confidenceByParcel.values()).reduce((a, b) => a + b, 0) /
        Math.max(1, confidenceByParcel.size);
      const qInfo = mapQualityChannelValue(meanConf, qualityOpacity);
      ctx.perf(
        `Boundary tension ${showTension ? 'on' : 'off'} | quality outlines ${showQuality ? 'on' : 'off'} | mean quality opacity ${(qInfo.mappedValue as number).toFixed(2)}`
      );

      viewer.requestRender();
    };

    const applyLensFromSelection = () => {
      const focusParcel = selectedParcel ?? getAutoFocusParcel();
      if (!focusParcel) {
        clearLensColumn(parcelData);
      } else {
        const shells = computeNeighborhoodShells(adjacency, focusParcel, maxHops);
        const shellMap = new Map<number, number>();
        for (const [node, hop] of shells) {
          shellMap.set(Number(node), hop);
        }
        updateLensColumn(parcelData, shellMap, maxHops);
      }

      lensLayer.setParcelData(parcelData, 'lens');
      viewer.requestRender();
    };

    applyLensFromSelection();
    refreshOverlays();
    viewer.centerCamera();

    ctx.panel.innerHTML = `
      <div class="panel-section">
        <h4>Topology</h4>
        <div class="panel-controls">
          <label style="display:flex;gap:6px;align-items:center;">
            <input id="toggle-tension" type="checkbox" checked />
            Boundary tension overlay
          </label>
          <label style="display:flex;gap:6px;align-items:center;">
            <input id="toggle-quality" type="checkbox" checked />
            Quality channel outlines
          </label>
        </div>
      </div>
      <div class="panel-section">
        <h4>Neighbor Lens</h4>
        <div class="panel-controls">
          <label style="font-size:0.85em;color:#b6c2cf;">Max hops</label>
          <input id="hop-slider" type="range" min="1" max="4" value="2" />
          <span id="hop-value" style="font-size:0.85em;color:#9fb0c4;">2</span>
          <button id="clear-selection" class="ghost">Use auto focus</button>
        </div>
      </div>
      <div class="panel-section">
        <h4>Data</h4>
        <div class="panel-controls">
          <button id="shuffle-values" class="primary">Reshuffle value field</button>
          <button id="cycle-colormap" class="ghost">Cycle colormap</button>
        </div>
      </div>
      <div class="panel-section">
        <p style="font-size:0.82em;color:#97a6b8;line-height:1.35;">
          Click a parcel to activate the neighborhood lens. This demo uses generic graph utilities: boundary metrics, BFS shells, and quality-channel mappings.
        </p>
      </div>
    `;

    const tensionToggle = ctx.panel.querySelector('#toggle-tension') as HTMLInputElement;
    const qualityToggle = ctx.panel.querySelector('#toggle-quality') as HTMLInputElement;
    const hopSlider = ctx.panel.querySelector('#hop-slider') as HTMLInputElement;
    const hopValue = ctx.panel.querySelector('#hop-value') as HTMLElement;

    tensionToggle?.addEventListener('change', () => {
      showTension = tensionToggle.checked;
      refreshOverlays();
    });

    qualityToggle?.addEventListener('change', () => {
      showQuality = qualityToggle.checked;
      refreshOverlays();
    });

    hopSlider?.addEventListener('input', () => {
      maxHops = parseInt(hopSlider.value, 10);
      hopValue.textContent = String(maxHops);
      applyLensFromSelection();
    });

    ctx.panel.querySelector('#clear-selection')?.addEventListener('click', () => {
      selectedParcel = null;
      applyLensFromSelection();
      refreshOverlays();
    });

    const cmaps = ['viridis', 'plasma', 'inferno', 'magma', 'cividis'];
    let cmapIndex = 0;
    ctx.panel.querySelector('#cycle-colormap')?.addEventListener('click', () => {
      cmapIndex = (cmapIndex + 1) % cmaps.length;
      valueLayer.setColorMap(cmaps[cmapIndex]);
      viewer.requestRender();
      ctx.perf(`Value colormap: ${cmaps[cmapIndex]}`);
    });

    ctx.panel.querySelector('#shuffle-values')?.addEventListener('click', () => {
      phase = (phase + 0.12) % 1;
      const nextData = makeParcelData(parcelCount, latBins, lonBins, phase);
      parcelData = nextData;
      valueLayer.setParcelData(parcelData, 'value');
      applyLensFromSelection();
      refreshOverlays();
    });

    const clickHandler = (event: { vertexIndex: number | null }) => {
      if (event.vertexIndex === null || event.vertexIndex < 0) {
        return;
      }
      const parcelId = vertexLabels[event.vertexIndex];
      if (!parcelId) {
        return;
      }

      selectedParcel = parcelId;
      applyLensFromSelection();
      refreshOverlays();
    };

    viewer.on('surface:click', clickHandler as any);

    return () => {
      viewer.off('surface:click', clickHandler as any);
      disposeGroup(tensionGroup);
      if (tensionGroup.parent) {
        tensionGroup.parent.remove(tensionGroup);
      }
      cleanup();
      ctx.status('Idle');
      ctx.perf('');
    };
  }
};
