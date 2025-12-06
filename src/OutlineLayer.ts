import * as THREE from 'three';
import { Layer, LayerConfig } from './layers';

export interface OutlineLayerOptions extends LayerConfig {
  roiLabels: Uint32Array | Int32Array | number[];
  color?: THREE.ColorRepresentation;
  width?: number;
  halo?: boolean;
  haloColor?: THREE.ColorRepresentation;
  haloWidth?: number;
  offset?: number;
  roiSubset?: number[] | null;
}

export interface OutlineLayerUpdate extends Partial<OutlineLayerOptions> {}

/**
 * Geometry-based layer that draws ROI boundaries as line segments.
 * This layer does not participate in color compositing; it renders its own
 * THREE.Line objects that are attached to the surface mesh.
 */
export class OutlineLayer extends Layer {
  roiLabels: Uint32Array;
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
      visible: options.visible,
      opacity: options.opacity ?? 1,
      blendMode: options.blendMode,
      order: options.order
    });

    if (!options.roiLabels) {
      throw new Error('OutlineLayer requires roiLabels');
    }

    this.roiLabels = options.roiLabels instanceof Uint32Array
      ? options.roiLabels
      : options.roiLabels instanceof Int32Array
        ? new Uint32Array(options.roiLabels)
        : new Uint32Array(options.roiLabels);

    this.order = options.order !== undefined ? options.order : 10;
    this.color = new THREE.Color(options.color ?? 0x000000).getHex();
    this.width = options.width ?? 1.5;
    this.halo = options.halo ?? false;
    this.haloColor = new THREE.Color(options.haloColor ?? 0xffffff).getHex();
    this.haloWidth = options.haloWidth ?? 1;
    this.offset = options.offset ?? 0;
    this.roiSubset = options.roiSubset ?? null;
  }

  /**
   * Outline layers do not contribute to the color composite.
   * Return a zeroed buffer to satisfy the abstract interface.
   */
  getRGBAData(vertexCount: number): Float32Array {
    return new Float32Array(vertexCount * 4);
  }

  update(update: OutlineLayerUpdate): void {
    if (update.roiLabels) {
      this.roiLabels = update.roiLabels instanceof Uint32Array
        ? update.roiLabels
        : update.roiLabels instanceof Int32Array
          ? new Uint32Array(update.roiLabels)
          : new Uint32Array(update.roiLabels);
    }
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

    this.needsUpdate = true;
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

// Register with factory without creating import cycle
Layer.registerOutlineLayer(OutlineLayer);
