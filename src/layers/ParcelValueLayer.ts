import { DataLayer, DataLayerConfig, DataLayerUpdateData } from '../layers';
import type { Color } from '../ColorMap';
import type { ParcelData, ParcelRecord } from '../parcellation';
import { validateParcelData, buildParcelLookup, mapParcelValuesToVertices } from '../parcellation';

export interface ParcelValueLayerConfig extends DataLayerConfig {
  valueColumn?: string;
}

export interface ParcelValueLayerUpdateData extends DataLayerUpdateData {
  parcelData?: ParcelData;
  vertexLabels?: Uint32Array | Int32Array | number[];
  valueColumn?: string;
}

function normalizeVertexLabels(vertexLabels: Uint32Array | Int32Array | number[]): Uint32Array {
  if (vertexLabels instanceof Uint32Array) {
    return vertexLabels;
  }
  if (vertexLabels instanceof Int32Array) {
    return new Uint32Array(vertexLabels);
  }
  return new Uint32Array(vertexLabels);
}

/**
 * Parcel-native data layer.
 *
 * Accepts parcel-level values plus per-vertex parcel labels and expands values to
 * vertices for rendering with the existing DataLayer compositing path.
 */
export class ParcelValueLayer extends DataLayer {
  private parcelData: ParcelData;
  private parcelLookup: Map<number, ParcelRecord>;
  private vertexLabels: Uint32Array;
  private valueColumn: string;

  constructor(
    id: string,
    parcelData: ParcelData,
    vertexLabels: Uint32Array | Int32Array | number[],
    colorMap: string | Color[] = 'viridis',
    config: ParcelValueLayerConfig = {}
  ) {
    const valueColumn = config.valueColumn ?? 'value';
    const validated = validateParcelData(parcelData);
    const normalizedLabels = normalizeVertexLabels(vertexLabels);
    const vertexData = mapParcelValuesToVertices(normalizedLabels, validated, valueColumn);

    super(id, vertexData, null, colorMap, config);

    this.parcelData = validated;
    this.parcelLookup = buildParcelLookup(validated);
    this.vertexLabels = normalizedLabels;
    this.valueColumn = valueColumn;
  }

  getParcelData(): ParcelData {
    return this.parcelData;
  }

  getValueColumn(): string {
    return this.valueColumn;
  }

  getVertexLabels(): Uint32Array {
    return this.vertexLabels.slice();
  }

  getParcelMetadata(parcelId: number): ParcelRecord | null {
    const row = this.parcelLookup.get(parcelId);
    return row || null;
  }

  getParcelValue(parcelId: number, valueColumn: string = this.valueColumn): number | null {
    const row = this.parcelLookup.get(parcelId);
    if (!row) {
      return null;
    }

    const value = row[valueColumn];
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      return null;
    }

    return value;
  }

  setParcelData(parcelData: ParcelData, valueColumn: string = this.valueColumn): void {
    this.parcelData = validateParcelData(parcelData);
    this.parcelLookup = buildParcelLookup(this.parcelData);
    this.valueColumn = valueColumn;
    this.refreshVertexData();
  }

  setVertexLabels(vertexLabels: Uint32Array | Int32Array | number[]): void {
    this.vertexLabels = normalizeVertexLabels(vertexLabels);
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
      this.parcelData = validateParcelData(updates.parcelData);
      this.parcelLookup = buildParcelLookup(this.parcelData);
      needsDataRefresh = true;
    }

    if (updates.vertexLabels !== undefined) {
      this.vertexLabels = normalizeVertexLabels(updates.vertexLabels);
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
      atlasId: this.parcelData.atlas.id,
      schemaVersion: this.parcelData.schema_version,
      parcelCount: this.parcelData.parcels.length
    };
  }

  private refreshVertexData(): void {
    const vertexData = mapParcelValuesToVertices(
      this.vertexLabels,
      this.parcelData,
      this.valueColumn
    );
    this.setData(vertexData, null);
  }
}

export default ParcelValueLayer;
