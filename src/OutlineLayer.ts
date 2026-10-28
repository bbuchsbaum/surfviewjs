import * as THREE from 'three';
import { assertLayerUpdateFields, Layer, LayerConfig, LayerUpdateData } from './layers';
import { finiteNumber, opacity as validateOpacity } from './utils/validation';

export interface OutlineLayerOptions extends LayerConfig {
  roiLabels: Uint32Array | Int32Array | number[];
  boundaryMode?: 'transition-edges' | 'midpoint';
  backgroundLabel?: number;
  color?: THREE.ColorRepresentation;
  width?: number;
  halo?: boolean;
  haloColor?: THREE.ColorRepresentation;
  haloWidth?: number;
  offset?: number;
  roiSubset?: number[] | null;
}

export interface OutlineLayerUpdate extends LayerUpdateData {
  roiLabels?: Uint32Array | Int32Array | number[];
  boundaryMode?: 'transition-edges' | 'midpoint';
  backgroundLabel?: number;
  color?: THREE.ColorRepresentation;
  width?: number;
  halo?: boolean;
  haloColor?: THREE.ColorRepresentation;
  haloWidth?: number;
  offset?: number;
  roiSubset?: number[] | null;
  /** @deprecated Use LayerStack ordering commands. */
  order?: number;
}

/**
 * Geometry-based layer that draws ROI boundaries as line segments.
 * This layer does not participate in color compositing; it renders its own
 * THREE.Line objects that are attached to the surface mesh.
 */
export class OutlineLayer extends Layer {
  roiLabels: Uint32Array | Int32Array;
  boundaryMode: 'transition-edges' | 'midpoint';
  backgroundLabel: number;
  labelRevision = 0;
  private labelEdits: { fromRevision: number; changes: readonly { vertex: number; label: number }[] } | undefined;
  get lastLabelEdits() { return this.labelEdits; }
  color: number;
  width: number;
  halo: boolean;
  haloColor: number;
  haloWidth: number;
  offset: number;
  roiSubset: number[] | null;
  lineObject: THREE.Object3D | null = null;
  haloObject: THREE.Object3D | null = null;

  constructor(id: string, options: OutlineLayerOptions) {
    super(id, {
      opacity: options.opacity ?? 1,
      order: options.order ?? 10,
      ...(options.visible === undefined ? {} : { visible: options.visible }),
      ...(options.blendMode === undefined ? {} : { blendMode: options.blendMode })
    }, {
      role: 'outline',
      pinned: 'top',
      reorderable: false
    });

    if (!options.roiLabels) {
      throw new Error('OutlineLayer requires roiLabels');
    }

    this.roiLabels = copyOutlineLabels(options.roiLabels);
    this.boundaryMode = validateBoundaryMode(options.boundaryMode ?? 'transition-edges');
    this.backgroundLabel = finiteNumber(options.backgroundLabel ?? 0, 'backgroundLabel', { integer: true });

    this.color = new THREE.Color(options.color ?? 0x000000).getHex();
    this.width = finiteNumber(options.width ?? 1.5, 'width', {
      minimum: 0,
      minimumExclusive: true
    });
    this.halo = options.halo ?? false;
    this.haloColor = new THREE.Color(options.haloColor ?? 0xffffff).getHex();
    this.haloWidth = finiteNumber(options.haloWidth ?? 1, 'haloWidth', { minimum: 0 });
    this.offset = finiteNumber(options.offset ?? 0, 'offset');
    this.roiSubset = options.roiSubset ?? null;
  }

  /**
   * Outline layers do not contribute to the color composite.
   * Return a zeroed buffer to satisfy the abstract interface.
   */
  getRGBAData(vertexCount: number): Float32Array {
    return new Float32Array(vertexCount * 4);
  }

  /** Local categorical edits; midpoint geometry updates only affected faces. */
  updateLabelVertices(changes: readonly { vertex: number; label: number }[]): void {
    for (const change of changes) {
      if (!Number.isSafeInteger(change.vertex) || change.vertex < 0 || change.vertex >= this.roiLabels.length) throw new RangeError('Outline vertex index out of range');
      const low = this.roiLabels instanceof Int32Array ? -2147483648 : 0, high = this.roiLabels instanceof Int32Array ? 2147483647 : 4294967295;
      if (!Number.isInteger(change.label) || change.label < low || change.label > high) throw new RangeError('Label edit must fit the current signed/unsigned label array');
    }
    const owned = Object.freeze(changes.map(change => Object.freeze({ ...change })));
    this.labelEdits = Object.freeze({ fromRevision: this.labelRevision, changes: owned });
    for (const change of owned) this.roiLabels[change.vertex] = change.label;
    this.labelRevision++; this._notifyChange();
  }

  update(update: OutlineLayerUpdate): void {
    assertLayerUpdateFields(update, 'OutlineLayer', [
      'roiLabels', 'color', 'width', 'halo', 'haloColor', 'haloWidth',
      'offset', 'roiSubset', 'order', 'boundaryMode', 'backgroundLabel'
    ]);
    if (update.width !== undefined) {
      finiteNumber(update.width, 'width', { minimum: 0, minimumExclusive: true });
    }
    if (update.haloWidth !== undefined) {
      finiteNumber(update.haloWidth, 'haloWidth', { minimum: 0 });
    }
    if (update.offset !== undefined) finiteNumber(update.offset, 'offset');
    if (update.opacity !== undefined) validateOpacity(update.opacity);
    if (update.order !== undefined) finiteNumber(update.order, 'order');
    const nextLabels = update.roiLabels ? copyOutlineLabels(update.roiLabels) : undefined;
    const nextMode = update.boundaryMode === undefined ? this.boundaryMode : validateBoundaryMode(update.boundaryMode);
    const nextBackground = update.backgroundLabel === undefined ? this.backgroundLabel : finiteNumber(update.backgroundLabel, 'backgroundLabel', { integer: true });
    if (nextLabels) { this.roiLabels = nextLabels; this.labelRevision++; this.labelEdits = undefined; }
    if (nextBackground !== this.backgroundLabel) this.labelRevision++;
    this.boundaryMode = nextMode; this.backgroundLabel = nextBackground;
    if (update.color !== undefined) {
      this.color = new THREE.Color(update.color).getHex();
    }
    if (update.width !== undefined) this.width = update.width;
    if (update.halo !== undefined) this.halo = update.halo;
    if (update.haloColor !== undefined) {
      this.haloColor = new THREE.Color(update.haloColor).getHex();
    }
    if (update.haloWidth !== undefined) this.haloWidth = update.haloWidth;
    if (update.offset !== undefined) this.offset = update.offset;
    if (update.roiSubset !== undefined) this.roiSubset = update.roiSubset;
    if (update.opacity !== undefined) this.setOpacity(update.opacity);
    if (update.visible !== undefined) this.setVisible(update.visible);
    if (update.blendMode !== undefined) this.setBlendMode(update.blendMode);
    if (update.order !== undefined) this.order = update.order;

    this._notifyChange();
  }

  toStateJSON(): Record<string, unknown> {
    return {
      ...super.toStateJSON(),
      type: 'outline',
      color: this.color,
      width: this.width,
      halo: this.halo,
      haloColor: this.haloColor,
      haloWidth: this.haloWidth,
      offset: this.offset,
      boundaryMode: this.boundaryMode,
      backgroundLabel: this.backgroundLabel
    };
  }

  dispose(): void {
    if (this.lineObject) {
      this.lineObject.traverse(obj => {
        const anyObj = obj as any;
        if (anyObj.geometry) {
          anyObj.geometry.dispose();
        }
        if (anyObj.material && typeof anyObj.material.dispose === 'function') {
          anyObj.material.dispose();
        }
      });
      this.lineObject = null;
    }

    if (this.haloObject) {
      this.haloObject.traverse(obj => {
        const anyObj = obj as any;
        if (anyObj.geometry) {
          anyObj.geometry.dispose();
        }
        if (anyObj.material && typeof anyObj.material.dispose === 'function') {
          anyObj.material.dispose();
        }
      });
      this.haloObject = null;
    }
  }
}

function validateBoundaryMode(mode: string): 'transition-edges' | 'midpoint' {
  if (mode !== 'transition-edges' && mode !== 'midpoint') throw new RangeError('Unknown outline boundary mode');
  return mode;
}
function copyOutlineLabels(labels: ArrayLike<number>): Uint32Array | Int32Array {
  let negative = false, unsigned = false;
  for (let i = 0; i < labels.length; i++) { const value = labels[i]!; if (!Number.isInteger(value) || value < -2147483648 || value > 4294967295) throw new RangeError('Outline labels must be 32-bit integers'); negative ||= value < 0; unsigned ||= value > 2147483647; }
  if (negative && unsigned) throw new RangeError('One outline cannot mix negative IDs and IDs above signed 32-bit range');
  return negative || labels instanceof Int32Array ? Int32Array.from(labels) : Uint32Array.from(labels);
}
