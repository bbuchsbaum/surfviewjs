import ColorMap, { Color } from '../ColorMap';
import {
  assertLayerUpdateFields,
  Layer,
  LayerConfig,
  LayerUpdateData
} from '../layers';
import type { ParcelData } from '../parcellation';
import { ParcelIndex } from '../parcellation';
import {
  finiteNumber,
  finitePair,
  opacity as validateOpacity
} from '../utils/validation';

export type ParcelConnectivityAlphaMode = 'constant' | 'magnitude';

export interface ParcelConnectivityLayerConfig extends LayerConfig {
  parcelIds?: ArrayLike<number>;
  seedParcelId?: number | null;
  range?: [number, number];
  threshold?: number | null;
  alphaMode?: ParcelConnectivityAlphaMode;
  alphaRange?: [number, number];
  useAbsoluteThreshold?: boolean;
  useAbsoluteAlpha?: boolean;
  showSeedParcel?: boolean;
}

export interface ParcelConnectivityLayerUpdate extends LayerUpdateData {
  matrix?: Float32Array | number[][] | number[];
  parcelData?: ParcelData;
  vertexLabels?: Uint32Array | Int32Array | number[];
  parcelIds?: ArrayLike<number>;
  seedParcelId?: number | null;
  colorMap?: ColorMap | string | Color[];
  range?: [number, number];
  threshold?: number | null;
  alphaMode?: ParcelConnectivityAlphaMode;
  alphaRange?: [number, number];
  useAbsoluteThreshold?: boolean;
  useAbsoluteAlpha?: boolean;
  showSeedParcel?: boolean;
}

function toFlatMatrix(matrix: Float32Array | number[][] | number[]): Float32Array {
  if (matrix instanceof Float32Array) {
    return matrix.slice();
  }

  if (Array.isArray(matrix) && Array.isArray(matrix[0])) {
    const rows = matrix as number[][];
    const size = rows.length;
    const flat = new Float32Array(size * size);
    for (let i = 0; i < size; i++) {
      const row = rows[i];
      if (!Array.isArray(row) || row.length !== size) {
        throw new Error('Parcel connectivity matrix must be square');
      }
      flat.set(row, i * size);
    }
    return flat;
  }

  return new Float32Array(matrix as number[]);
}

function validateAlphaRange(alphaRange: [number, number]): [number, number] {
  const pair = finitePair(alphaRange, 'alphaRange');
  validateOpacity(pair[0], 'alphaRange[0]');
  validateOpacity(pair[1], 'alphaRange[1]');
  return pair;
}

function validateAlphaMode(alphaMode: ParcelConnectivityAlphaMode): ParcelConnectivityAlphaMode {
  if (alphaMode !== 'constant' && alphaMode !== 'magnitude') {
    throw new TypeError(
      `alphaMode must be "constant" or "magnitude"; received ${String(alphaMode)}.`
    );
  }
  return alphaMode;
}

function inferMatrixSize(flatMatrix: Float32Array): number {
  const size = Math.round(Math.sqrt(flatMatrix.length));
  if (size * size !== flatMatrix.length) {
    throw new Error('Parcel connectivity matrix length must be a perfect square');
  }
  return size;
}

function inferRange(flatMatrix: Float32Array): [number, number] {
  let min = Infinity;
  let max = -Infinity;

  for (let i = 0; i < flatMatrix.length; i++) {
    const value = flatMatrix[i]!;
    if (!Number.isFinite(value)) {
      continue;
    }
    min = Math.min(min, value);
    max = Math.max(max, value);
  }

  if (min === Infinity || max === -Infinity) {
    return [0, 1];
  }
  if (min === max) {
    return [min, min + 1];
  }
  return [min, max];
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

/**
 * Parcel-native connectivity overlay.
 *
 * Given a parcel x parcel matrix plus a seed parcel id, this layer paints the
 * surface by the seed parcel's connectivity to every other parcel.
 */
export class ParcelConnectivityLayer extends Layer {
  private parcelIndex: ParcelIndex;
  private matrix: Float32Array;
  private matrixSize: number;
  private parcelIds: Uint32Array;
  private parcelIdToRow: Map<number, number>;
  private seedParcelId: number | null;
  private colorMap: ColorMap;
  private colorMapName: string;
  private range: [number, number];
  private threshold: number | null;
  private alphaMode: ParcelConnectivityAlphaMode;
  private alphaRange: [number, number];
  private useAbsoluteThreshold: boolean;
  private useAbsoluteAlpha: boolean;
  private showSeedParcel: boolean;
  private rgbaBuffer: Float32Array | null = null;

  constructor(
    id: string,
    matrix: Float32Array | number[][] | number[],
    parcelData: ParcelData,
    vertexLabels: Uint32Array | Int32Array | number[],
    colorMap: ColorMap | string | Color[] = 'viridis',
    config: ParcelConnectivityLayerConfig = {}
  ) {
    super(id, config);

    this.parcelIndex = new ParcelIndex(parcelData, vertexLabels);
    this.matrix = toFlatMatrix(matrix);
    this.matrixSize = inferMatrixSize(this.matrix);
    this.parcelIds = this.resolveParcelIds(config.parcelIds);
    this.parcelIdToRow = this.buildParcelIdToRow(this.parcelIds);
    this.seedParcelId = null;
    this.range = config.range === undefined
      ? inferRange(this.matrix)
      : finitePair(config.range, 'range');
    this.threshold = config.threshold === undefined || config.threshold === null
      ? null
      : finiteNumber(config.threshold, 'threshold');
    this.alphaMode = validateAlphaMode(config.alphaMode ?? 'magnitude');
    this.alphaRange = validateAlphaRange(config.alphaRange ?? [0, 1]);
    this.useAbsoluteThreshold = config.useAbsoluteThreshold ?? true;
    this.useAbsoluteAlpha = config.useAbsoluteAlpha ?? true;
    this.showSeedParcel = config.showSeedParcel ?? true;

    const resolved = this.resolveColorMap(colorMap);
    this.colorMap = resolved.map;
    this.colorMapName = resolved.name;
    this.colorMap.setRange(this.range);
    if (config.seedParcelId !== undefined) {
      this.seedParcelId = this.validatedSeedParcel(config.seedParcelId);
    }
  }

  getParcelData(): ParcelData {
    return this.parcelIndex.getParcelData();
  }

  getVertexLabels(): Uint32Array {
    return this.parcelIndex.getVertexLabels();
  }

  getSeedParcelId(): number | null {
    return this.seedParcelId;
  }

  getParcelIds(): Uint32Array {
    return this.parcelIds.slice();
  }

  getRange(): [number, number] {
    return [...this.range] as [number, number];
  }

  getThreshold(): number | null {
    return this.threshold;
  }

  getColorMapName(): string {
    return this.colorMapName;
  }

  setSeedParcel(parcelId: number | null): void {
    this.seedParcelId = this.validatedSeedParcel(parcelId);
    this._notifyChange();
  }

  setSeedFromVertex(vertexIndex: number): void {
    const nextIndex = finiteNumber(vertexIndex, 'vertexIndex', {
      minimum: 0,
      maximum: this.getVertexLabels().length - 1,
      integer: true
    });
    this.setSeedParcel(this.parcelIndex.getParcelIdForVertex(nextIndex));
  }

  getConnectivityValue(parcelId: number, seedParcelId: number | null = this.seedParcelId): number | null {
    if (seedParcelId === null) {
      return null;
    }

    const row = this.parcelIdToRow.get(seedParcelId);
    const col = this.parcelIdToRow.get(parcelId);
    if (row === undefined || col === undefined) {
      return null;
    }

    const value = this.matrix[row * this.matrixSize + col]!;
    return Number.isFinite(value) ? value : null;
  }

  setMatrix(matrix: Float32Array | number[][] | number[], parcelIds?: ArrayLike<number>): void {
    const nextMatrix = toFlatMatrix(matrix);
    const nextMatrixSize = inferMatrixSize(nextMatrix);
    const nextParcelIds = this.resolveParcelIds(parcelIds, nextMatrixSize);
    const nextParcelIdToRow = this.buildParcelIdToRow(nextParcelIds);
    const nextRange = inferRange(nextMatrix);
    this.matrix = nextMatrix;
    this.matrixSize = nextMatrixSize;
    this.parcelIds = nextParcelIds;
    this.parcelIdToRow = nextParcelIdToRow;
    this.range = nextRange;
    this.colorMap.setRange(nextRange);
    if (this.seedParcelId !== null && !nextParcelIdToRow.has(this.seedParcelId)) {
      this.seedParcelId = null;
    }
    this._notifyChange();
  }

  setParcelData(parcelData: ParcelData): void {
    this.parcelIndex.setParcelData(parcelData);
    if (!this.areParcelIdsCompatible()) {
      this.parcelIds = this.resolveParcelIds();
      this.parcelIdToRow = this.buildParcelIdToRow(this.parcelIds);
      if (this.seedParcelId !== null && !this.parcelIdToRow.has(this.seedParcelId)) {
        this.seedParcelId = null;
      }
    }
    this._notifyChange();
  }

  setVertexLabels(vertexLabels: Uint32Array | Int32Array | number[]): void {
    this.parcelIndex.setVertexLabels(vertexLabels);
    this._notifyChange();
  }

  setColorMap(colorMap: ColorMap | string | Color[]): void {
    const resolved = this.resolveColorMap(colorMap);
    this.colorMap = resolved.map;
    this.colorMapName = resolved.name;
    this.colorMap.setRange(this.range);
    this._notifyChange();
  }

  setRange(range: [number, number]): void {
    const nextRange = finitePair(range, 'range');
    this.range = nextRange;
    this.colorMap.setRange(nextRange);
    this._notifyChange();
  }

  setThreshold(threshold: number | null): void {
    this.threshold = threshold === null ? null : finiteNumber(threshold, 'threshold');
    this._notifyChange();
  }

  setAlphaMode(alphaMode: ParcelConnectivityAlphaMode): void {
    this.alphaMode = validateAlphaMode(alphaMode);
    this._notifyChange();
  }

  setAlphaRange(alphaRange: [number, number]): void {
    this.alphaRange = validateAlphaRange(alphaRange);
    this._notifyChange();
  }

  getRGBAData(vertexCount: number): Float32Array {
    if (!this.rgbaBuffer || this.rgbaBuffer.length !== vertexCount * 4) {
      this.rgbaBuffer = new Float32Array(vertexCount * 4);
    }

    const rgba = this.rgbaBuffer;
    rgba.fill(0);

    if (this.seedParcelId === null) {
      this.needsUpdate = false;
      return rgba;
    }

    const vertexLabels = this.parcelIndex.getVertexLabels();
    for (let i = 0; i < vertexCount; i++) {
      const parcelId = vertexLabels[i];
      if (!parcelId) {
        continue;
      }
      if (!this.showSeedParcel && parcelId === this.seedParcelId) {
        continue;
      }

      const value = this.getConnectivityValue(parcelId, this.seedParcelId);
      if (value === null) {
        continue;
      }
      if (!this.passesThreshold(value)) {
        continue;
      }

      const color = this.colorMap.getColor(value);
      const alpha = this.computeAlpha(value, color[3] ?? 1);
      if (alpha <= 0) {
        continue;
      }

      const offset = i * 4;
      rgba[offset] = color[0];
      rgba[offset + 1] = color[1];
      rgba[offset + 2] = color[2];
      rgba[offset + 3] = alpha;
    }

    this.needsUpdate = false;
    return rgba;
  }

  update(updates: ParcelConnectivityLayerUpdate): void {
    assertLayerUpdateFields(updates, 'ParcelConnectivityLayer', [
      'matrix', 'parcelData', 'vertexLabels', 'parcelIds', 'seedParcelId',
      'colorMap', 'range', 'threshold', 'alphaMode', 'alphaRange',
      'useAbsoluteThreshold', 'useAbsoluteAlpha', 'showSeedParcel'
    ]);
    if (updates.range !== undefined) finitePair(updates.range, 'range');
    if (updates.threshold !== undefined && updates.threshold !== null) {
      finiteNumber(updates.threshold, 'threshold');
    }
    if (updates.alphaRange !== undefined) validateAlphaRange(updates.alphaRange);
    if (updates.alphaMode !== undefined) validateAlphaMode(updates.alphaMode);
    if (updates.opacity !== undefined) validateOpacity(updates.opacity);
    if (updates.colorMap !== undefined) this.resolveColorMap(updates.colorMap);

    let candidateParcelIdToRow = this.parcelIdToRow;
    if (updates.matrix !== undefined) {
      const candidateMatrix = toFlatMatrix(updates.matrix);
      const candidateSize = inferMatrixSize(candidateMatrix);
      const candidateIds = this.resolveParcelIds(updates.parcelIds, candidateSize);
      candidateParcelIdToRow = this.buildParcelIdToRow(candidateIds);
    } else if (updates.parcelIds !== undefined) {
      const candidateIds = this.resolveParcelIds(updates.parcelIds);
      candidateParcelIdToRow = this.buildParcelIdToRow(candidateIds);
    }
    if (updates.seedParcelId !== undefined) {
      this.validatedSeedParcel(updates.seedParcelId, candidateParcelIdToRow);
    }

    if (updates.matrix !== undefined) {
      this.setMatrix(updates.matrix, updates.parcelIds);
    } else if (updates.parcelIds !== undefined) {
      const nextParcelIds = this.resolveParcelIds(updates.parcelIds);
      const nextParcelIdToRow = this.buildParcelIdToRow(nextParcelIds);
      this.parcelIds = nextParcelIds;
      this.parcelIdToRow = nextParcelIdToRow;
      this._notifyChange();
    }
    if (updates.parcelData !== undefined) {
      this.setParcelData(updates.parcelData);
    }
    if (updates.vertexLabels !== undefined) {
      this.setVertexLabels(updates.vertexLabels);
    }
    if (updates.seedParcelId !== undefined) {
      this.setSeedParcel(updates.seedParcelId);
    }
    if (updates.colorMap !== undefined) {
      this.setColorMap(updates.colorMap);
    }
    if (updates.range !== undefined) {
      this.setRange(updates.range);
    }
    if (updates.threshold !== undefined) {
      this.setThreshold(updates.threshold);
    }
    if (updates.alphaMode !== undefined) {
      this.setAlphaMode(updates.alphaMode);
    }
    if (updates.alphaRange !== undefined) {
      this.setAlphaRange(updates.alphaRange);
    }
    if (updates.useAbsoluteThreshold !== undefined) {
      this.useAbsoluteThreshold = updates.useAbsoluteThreshold;
      this._notifyChange();
    }
    if (updates.useAbsoluteAlpha !== undefined) {
      this.useAbsoluteAlpha = updates.useAbsoluteAlpha;
      this._notifyChange();
    }
    if (updates.showSeedParcel !== undefined) {
      this.showSeedParcel = updates.showSeedParcel;
      this._notifyChange();
    }
    if (updates.opacity !== undefined) {
      this.setOpacity(updates.opacity);
    }
    if (updates.visible !== undefined) {
      this.setVisible(updates.visible);
    }
    if (updates.blendMode !== undefined) {
      this.setBlendMode(updates.blendMode);
    }
  }

  toStateJSON(): Record<string, unknown> {
    return {
      ...super.toStateJSON(),
      type: 'parcel-connectivity',
      colorMapName: this.colorMapName,
      range: [...this.range],
      threshold: this.threshold,
      alphaMode: this.alphaMode,
      alphaRange: [...this.alphaRange],
      seedParcelId: this.seedParcelId,
      parcelCount: this.parcelIds.length
    };
  }

  private resolveParcelIds(
    parcelIds?: ArrayLike<number>,
    matrixSize: number = this.matrixSize
  ): Uint32Array {
    const ids = parcelIds
      ? Array.from(parcelIds)
      : this.getParcelData().parcels.map(parcel => parcel.id);

    if (ids.length !== matrixSize) {
      throw new Error(
        `Parcel connectivity matrix size ${matrixSize} does not match parcelIds length ${ids.length}`
      );
    }

    return new Uint32Array(ids.map((id, index) => finiteNumber(id, `parcelIds[${index}]`, {
      minimum: 0,
      maximum: 0xffffffff,
      integer: true
    })));
  }

  private validatedSeedParcel(
    parcelId: number | null,
    parcelIdToRow: Map<number, number> = this.parcelIdToRow
  ): number | null {
    if (parcelId === null) return null;
    const normalized = finiteNumber(parcelId, 'seedParcelId', {
      minimum: 0,
      maximum: 0xffffffff,
      integer: true
    });
    if (!parcelIdToRow.has(normalized)) {
      throw new Error(`Unknown parcel id '${normalized}' for connectivity matrix`);
    }
    return normalized;
  }

  private buildParcelIdToRow(parcelIds: Uint32Array): Map<number, number> {
    const lookup = new Map<number, number>();
    for (let i = 0; i < parcelIds.length; i++) {
      const parcelId = parcelIds[i]!;
      if (lookup.has(parcelId)) {
        throw new Error(`Duplicate parcel id '${parcelId}' in connectivity matrix`);
      }
      lookup.set(parcelId, i);
    }
    return lookup;
  }

  private resolveColorMap(colorMap: ColorMap | string | Color[]): { map: ColorMap; name: string } {
    if (colorMap instanceof ColorMap) {
      return { map: colorMap, name: 'custom' };
    }
    if (typeof colorMap === 'string') {
      return { map: ColorMap.fromPreset(colorMap), name: colorMap };
    }
    return { map: new ColorMap(colorMap), name: 'custom' };
  }

  private passesThreshold(value: number): boolean {
    if (this.threshold === null || this.threshold === undefined) {
      return true;
    }

    const metric = this.useAbsoluteThreshold ? Math.abs(value) : value;
    return metric >= this.threshold;
  }

  private computeAlpha(value: number, colorAlpha: number): number {
    if (this.alphaMode === 'constant') {
      return clamp01(this.alphaRange[1] * colorAlpha);
    }

    const metric = this.useAbsoluteAlpha ? Math.abs(value) : value;
    const [rangeMin, rangeMax] = this.useAbsoluteAlpha
      ? [
          this.range[0] <= 0 && this.range[1] >= 0 ? 0 : Math.min(Math.abs(this.range[0]), Math.abs(this.range[1])),
          Math.max(Math.abs(this.range[0]), Math.abs(this.range[1]))
        ]
      : this.range;

    const denom = rangeMax - rangeMin;
    const normalized = denom <= 0 ? 1 : clamp01((metric - rangeMin) / denom);
    const alpha = this.alphaRange[0] + normalized * (this.alphaRange[1] - this.alphaRange[0]);
    return clamp01(alpha * colorAlpha);
  }

  private areParcelIdsCompatible(): boolean {
    const parcelIds = this.getParcelData().parcels.map(parcel => parcel.id);
    if (parcelIds.length !== this.parcelIds.length) {
      return false;
    }
    for (let i = 0; i < parcelIds.length; i++) {
      if (parcelIds[i] !== this.parcelIds[i]) {
        return false;
      }
    }
    return true;
  }
}

export default ParcelConnectivityLayer;
