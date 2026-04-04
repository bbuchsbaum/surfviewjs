import * as THREE from 'three';
import { SurfaceGeometry } from '../classes';
import { LabelLayer, LayerConfig } from '../layers';
import { MultiLayerNeuroSurface, MultiLayerSurfaceConfig } from '../MultiLayerNeuroSurface';
import { OutlineLayer, OutlineLayerOptions } from '../OutlineLayer';
import { LabelDefinition } from '../LabeledNeuroSurface';
import { ParcelValueLayer, ParcelValueLayerConfig } from '../layers/ParcelValueLayer';
import { ParcelConnectivityLayer, ParcelConnectivityLayerConfig } from '../layers/ParcelConnectivityLayer';
import type { ParcelData, ParcelRecord } from '../parcellation';
import { ParcelIndex } from '../parcellation';

export interface ParcelSurfaceConfig extends MultiLayerSurfaceConfig {
  parcelData: ParcelData;
  vertexLabels: Uint32Array | Int32Array | number[];
}

export interface ParcelColorLayerConfig extends LayerConfig {
  defaultColor?: THREE.ColorRepresentation;
}

export type ParcelColorResolver =
  | Map<number, THREE.ColorRepresentation>
  | Record<number, THREE.ColorRepresentation>
  | ((parcel: ParcelRecord) => THREE.ColorRepresentation | null | undefined);

interface ParcelColorLayerBinding {
  colorResolver: ParcelColorResolver;
}

function resolveParcelColor(
  parcel: ParcelRecord,
  colorResolver: ParcelColorResolver
): THREE.ColorRepresentation | null {
  if (colorResolver instanceof Map) {
    return colorResolver.get(parcel.id) ?? null;
  }

  if (typeof colorResolver === 'function') {
    return colorResolver(parcel) ?? null;
  }

  return colorResolver[parcel.id] ?? null;
}

/**
 * Parcel-native surface that owns one canonical mesh parcellation and exposes
 * parcel-aware rendering and interaction helpers on top of MultiLayerNeuroSurface.
 */
export class ParcelSurface extends MultiLayerNeuroSurface {
  private parcelIndex: ParcelIndex;
  private parcelColorLayers: Map<string, ParcelColorLayerBinding>;

  constructor(geometry: SurfaceGeometry, config: ParcelSurfaceConfig) {
    const { parcelData, vertexLabels, ...surfaceConfig } = config;
    super(geometry, surfaceConfig);

    this.assertVertexLabelLength(vertexLabels);
    this.parcelIndex = new ParcelIndex(parcelData, vertexLabels);
    this.parcelColorLayers = new Map();
  }

  getParcelData(): ParcelData {
    return this.parcelIndex.getParcelData();
  }

  getParcelIndex(): ParcelIndex {
    return this.parcelIndex;
  }

  getVertexLabels(): Uint32Array {
    return this.parcelIndex.getVertexLabels();
  }

  getParcelIdForVertex(vertexIndex: number): number | null {
    return this.parcelIndex.getParcelIdForVertex(vertexIndex);
  }

  getParcelRecord(parcelId: number): ParcelRecord | null {
    return this.parcelIndex.getParcelRecord(parcelId);
  }

  getParcelRecordForVertex(vertexIndex: number): ParcelRecord | null {
    return this.parcelIndex.getParcelRecordForVertex(vertexIndex);
  }

  getVertexIndicesForParcel(parcelId: number): Uint32Array {
    const labels = this.getVertexLabels();
    const indices: number[] = [];

    for (let i = 0; i < labels.length; i++) {
      if (labels[i] === parcelId) {
        indices.push(i);
      }
    }

    return new Uint32Array(indices);
  }

  getRepresentativeVertexIndex(parcelId: number): number | null {
    const vertexIndices = this.getVertexIndicesForParcel(parcelId);
    if (vertexIndices.length === 0) {
      return null;
    }

    const vertices = this.geometry.vertices;
    let cx = 0;
    let cy = 0;
    let cz = 0;

    for (let i = 0; i < vertexIndices.length; i++) {
      const vertexIndex = vertexIndices[i];
      const offset = vertexIndex * 3;
      cx += vertices[offset];
      cy += vertices[offset + 1];
      cz += vertices[offset + 2];
    }

    const invCount = 1 / vertexIndices.length;
    cx *= invCount;
    cy *= invCount;
    cz *= invCount;

    let bestVertex = vertexIndices[0];
    let bestDistance = Infinity;

    for (let i = 0; i < vertexIndices.length; i++) {
      const vertexIndex = vertexIndices[i];
      const offset = vertexIndex * 3;
      const dx = vertices[offset] - cx;
      const dy = vertices[offset + 1] - cy;
      const dz = vertices[offset + 2] - cz;
      const distance = dx * dx + dy * dy + dz * dz;

      if (distance < bestDistance) {
        bestDistance = distance;
        bestVertex = vertexIndex;
      }
    }

    return bestVertex;
  }

  getParcelValue(parcelId: number, valueColumn: string = 'value'): number | null {
    return this.parcelIndex.getParcelValue(parcelId, valueColumn);
  }

  mapParcelValues(valueColumn: string = 'value'): Float32Array {
    return this.parcelIndex.mapParcelValues(valueColumn);
  }

  setParcelData(parcelData: ParcelData): void {
    this.parcelIndex.setParcelData(parcelData);
    this.syncParcelLayers({ parcelDataChanged: true, vertexLabelsChanged: false });
  }

  setVertexLabels(vertexLabels: Uint32Array | Int32Array | number[]): void {
    this.assertVertexLabelLength(vertexLabels);
    this.parcelIndex.setVertexLabels(vertexLabels);
    this.syncParcelLayers({ parcelDataChanged: false, vertexLabelsChanged: true });
  }

  setParcellation(
    parcelData: ParcelData,
    vertexLabels: Uint32Array | Int32Array | number[]
  ): void {
    this.assertVertexLabelLength(vertexLabels);
    this.parcelIndex.setParcellation(parcelData, vertexLabels);
    this.syncParcelLayers({ parcelDataChanged: true, vertexLabelsChanged: true });
  }

  addParcelColorLayer(
    id: string,
    colorResolver: ParcelColorResolver,
    config: ParcelColorLayerConfig = {}
  ): LabelLayer {
    const layer = new LabelLayer(id, {
      labels: this.getVertexLabels(),
      labelDefs: this.buildParcelLabelDefinitions(colorResolver),
      defaultColor: config.defaultColor,
      visible: config.visible,
      opacity: config.opacity,
      blendMode: config.blendMode,
      order: config.order
    });

    this.parcelColorLayers.set(id, { colorResolver });
    this.addLayer(layer);
    return layer;
  }

  addParcelOutlineLayer(
    id: string,
    config: Omit<OutlineLayerOptions, 'roiLabels'> = {}
  ): OutlineLayer {
    // V1 outline support uses per-edge parcel transitions on the mesh.
    // True parcel boundary loop tracing can be added later without changing
    // the public ParcelSurface API.
    const layer = new OutlineLayer(id, {
      ...config,
      roiLabels: this.getVertexLabels()
    });
    this.addLayer(layer);
    return layer;
  }

  addParcelValueLayer(
    id: string,
    parcelDataOrValueColumn: ParcelData | string = 'value',
    vertexLabelsOrColorMap?: Uint32Array | Int32Array | number[] | string,
    colorMapOrConfig?: string | ParcelValueLayerConfig,
    maybeConfig: ParcelValueLayerConfig = {}
  ): ParcelValueLayer {
    if (typeof parcelDataOrValueColumn === 'string') {
      const colorMap = typeof vertexLabelsOrColorMap === 'string'
        ? vertexLabelsOrColorMap
        : 'viridis';
      const config = (typeof colorMapOrConfig === 'object' && colorMapOrConfig !== null)
        ? colorMapOrConfig
        : maybeConfig;
      const layer = new ParcelValueLayer(id, this.getParcelData(), this.getVertexLabels(), colorMap, {
        ...config,
        valueColumn: parcelDataOrValueColumn
      });
      this.addLayer(layer);
      return layer;
    }

    const colorMap = typeof colorMapOrConfig === 'string' ? colorMapOrConfig : 'viridis';
    const config = (typeof colorMapOrConfig === 'object' && colorMapOrConfig !== null)
      ? colorMapOrConfig
      : maybeConfig;
    const vertexLabels = Array.isArray(vertexLabelsOrColorMap) || vertexLabelsOrColorMap instanceof Uint32Array || vertexLabelsOrColorMap instanceof Int32Array
      ? vertexLabelsOrColorMap
      : this.getVertexLabels();

    this.assertVertexLabelLength(vertexLabels);
    const layer = new ParcelValueLayer(id, parcelDataOrValueColumn, vertexLabels, colorMap, config);
    this.addLayer(layer);
    return layer;
  }

  addParcelConnectivityLayer(
    id: string,
    matrix: Float32Array | number[][] | number[],
    colorMap: string = 'viridis',
    config: ParcelConnectivityLayerConfig = {}
  ): ParcelConnectivityLayer {
    const layer = new ParcelConnectivityLayer(
      id,
      matrix,
      this.getParcelData(),
      this.getVertexLabels(),
      colorMap,
      config
    );
    this.addLayer(layer);
    return layer;
  }

  override removeLayer(id: string): boolean {
    this.parcelColorLayers.delete(id);
    return super.removeLayer(id);
  }

  override getPickMetadata(vertexIndex: number): Record<string, unknown> | null {
    const parcelId = this.getParcelIdForVertex(vertexIndex);
    if (parcelId === null) {
      return null;
    }

    const parcel = this.getParcelRecord(parcelId);
    return {
      parcelId,
      parcel,
      parcelLabel: parcel?.label ?? null,
      atlasId: this.getParcelData().atlas.id
    };
  }

  private assertVertexLabelLength(vertexLabels: Uint32Array | Int32Array | number[]): void {
    if (vertexLabels.length !== this.vertexCount) {
      throw new Error(
        `vertexLabels length ${vertexLabels.length} does not match vertex count ${this.vertexCount}`
      );
    }
  }

  private buildParcelLabelDefinitions(colorResolver: ParcelColorResolver): LabelDefinition[] {
    const labelDefs: LabelDefinition[] = [];

    for (const parcel of this.getParcelData().parcels) {
      const color = resolveParcelColor(parcel, colorResolver);
      if (color === null || color === undefined) {
        continue;
      }

      labelDefs.push({
        id: parcel.id,
        name: parcel.label,
        color
      });
    }

    return labelDefs;
  }

  private syncParcelLayers(flags: { parcelDataChanged: boolean; vertexLabelsChanged: boolean }): void {
    const layers = this.layerStack.getAllLayers();
    const vertexLabels = this.getVertexLabels();

    for (const layer of layers) {
      if (layer instanceof ParcelValueLayer) {
        if (flags.parcelDataChanged) {
          layer.setParcelData(this.getParcelData(), layer.getValueColumn());
        }
        if (flags.vertexLabelsChanged) {
          layer.setVertexLabels(vertexLabels);
        }
        continue;
      }

      if (layer instanceof ParcelConnectivityLayer) {
        if (flags.parcelDataChanged) {
          layer.setParcelData(this.getParcelData());
        }
        if (flags.vertexLabelsChanged) {
          layer.setVertexLabels(vertexLabels);
        }
        continue;
      }

      if (layer instanceof LabelLayer) {
        const binding = this.parcelColorLayers.get(layer.id);
        if (!binding) {
          continue;
        }
        if (flags.vertexLabelsChanged) {
          layer.setLabels(vertexLabels);
        }
        if (flags.parcelDataChanged) {
          layer.setLabelDefs(this.buildParcelLabelDefinitions(binding.colorResolver));
        }
        continue;
      }

      if (layer instanceof OutlineLayer && flags.vertexLabelsChanged) {
        layer.update({ roiLabels: vertexLabels });
      }
    }
  }
}

export default ParcelSurface;
