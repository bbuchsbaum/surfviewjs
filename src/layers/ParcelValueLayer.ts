import { DataLayer, DataLayerConfig, DataLayerUpdateData } from '../layers';
import type { Color } from '../ColorMap';
import type { ParcelData, ParcelRecord } from '../parcellation';
import { ParcelIndex } from '../parcellation';

export interface ParcelValueLayerConfig extends DataLayerConfig {
  valueColumn?: string;
}

export interface ParcelValueLayerUpdateData extends DataLayerUpdateData {
  parcelData?: ParcelData;
  vertexLabels?: Uint32Array | Int32Array | number[];
  valueColumn?: string;
}

/**
 * Parcel-native data layer.
 *
 * Accepts parcel-level values plus per-vertex parcel labels and expands values to
 * vertices for rendering with the existing DataLayer compositing path.
 */
export class ParcelValueLayer extends DataLayer {
  private parcelIndex: ParcelIndex;
  private valueColumn: string;

  constructor(
    id: string,
    parcelData: ParcelData,
    vertexLabels: Uint32Array | Int32Array | number[],
    colorMap: string | Color[] = 'viridis',
    config: ParcelValueLayerConfig = {}
  ) {
    const valueColumn = config.valueColumn ?? 'value';
    const parcelIndex = new ParcelIndex(parcelData, vertexLabels);
    const vertexData = parcelIndex.mapParcelValues(valueColumn);

    super(id, vertexData, null, colorMap, config);

    this.parcelIndex = parcelIndex;
    this.valueColumn = valueColumn;
  }

  getParcelData(): ParcelData {
    return this.parcelIndex.getParcelData();
  }

  getValueColumn(): string {
    return this.valueColumn;
  }

  getVertexLabels(): Uint32Array {
    return this.parcelIndex.getVertexLabels();
  }

  getParcelMetadata(parcelId: number): ParcelRecord | null {
    return this.parcelIndex.getParcelRecord(parcelId);
  }

  getParcelValue(parcelId: number, valueColumn: string = this.valueColumn): number | null {
    return this.parcelIndex.getParcelValue(parcelId, valueColumn);
  }

  setParcelData(parcelData: ParcelData, valueColumn: string = this.valueColumn): void {
    this.parcelIndex.setParcelData(parcelData);
    this.valueColumn = valueColumn;
    this.refreshVertexData();
  }

  setVertexLabels(vertexLabels: Uint32Array | Int32Array | number[]): void {
    this.parcelIndex.setVertexLabels(vertexLabels);
    this.refreshVertexData();
  }

  setValueColumn(valueColumn: string): void {
    if (typeof valueColumn !== 'string' || valueColumn.length === 0) {
      throw new Error("'valueColumn' must be a non-empty string");
    }
    this.valueColumn = valueColumn;
    this.refreshVertexData();
  }

  update(updates: ParcelValueLayerUpdateData): void {
    let needsDataRefresh = false;

    if (updates.parcelData !== undefined) {
      this.parcelIndex.setParcelData(updates.parcelData);
      needsDataRefresh = true;
    }

    if (updates.vertexLabels !== undefined) {
      this.parcelIndex.setVertexLabels(updates.vertexLabels);
      needsDataRefresh = true;
    }

    if (updates.valueColumn !== undefined) {
      if (typeof updates.valueColumn !== 'string' || updates.valueColumn.length === 0) {
        throw new Error("'valueColumn' must be a non-empty string");
      }
      this.valueColumn = updates.valueColumn;
      needsDataRefresh = true;
    }

    if (needsDataRefresh) {
      this.refreshVertexData();
    }

    const dataUpdates: DataLayerUpdateData = {
      colorMap: updates.colorMap,
      range: updates.range,
      threshold: updates.threshold,
      opacity: updates.opacity,
      visible: updates.visible,
      blendMode: updates.blendMode
    };

    super.update(dataUpdates);
  }

  toStateJSON(): Record<string, unknown> {
    return {
      ...super.toStateJSON(),
      type: 'parcel',
      valueColumn: this.valueColumn,
      atlasId: this.getParcelData().atlas.id,
      schemaVersion: this.getParcelData().schema_version,
      parcelCount: this.getParcelData().parcels.length
    };
  }

  private refreshVertexData(): void {
    const vertexData = this.parcelIndex.mapParcelValues(this.valueColumn);
    this.setData(vertexData, null);
  }
}

export default ParcelValueLayer;
