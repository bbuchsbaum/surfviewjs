import * as THREE from 'three';
import { NeuroSurface, SurfaceGeometry, SurfaceConfig } from '../classes';
import { VolumeProjectionMaterial } from '../materials/VolumeProjectionMaterial';
import { VolumeTexture3D } from '../textures/VolumeTexture3D';
import { createColormapTexture } from '../textures/createColormapTexture';
import type { RibbonReducer, VolumeProjectionMode } from '../layers';
import { finiteNumber, finitePair, opacity as validateOpacity } from '../utils/validation';

export interface VolumeProjectedSurfaceOptions {
  volumeData: Float32Array | ArrayLike<number>;
  volumeDims: [number, number, number];
  /**
   * 4x4 voxel-to-world affine matrix (column-major) or Matrix4.
   * If provided, this is inverted to compute world->voxel sampling.
   */
  affineMatrix?: THREE.Matrix4 | ArrayLike<number>;
  /**
   * Optional override for world->voxel transform (column-major) or Matrix4.
   */
  worldToIJK?: THREE.Matrix4 | ArrayLike<number>;
  /**
   * Simple voxel-to-world fallback when no affine is provided.
   */
  voxelSize?: [number, number, number];
  volumeOrigin?: [number, number, number];

  useHalfFloat?: boolean;

  colormap?: string;
  intensityRange?: [number, number];
  threshold?: [number, number];
  overlayOpacity?: number;
  baseColor?: THREE.ColorRepresentation;
  fillValue?: number;
  projectionMode?: VolumeProjectionMode;
  pialPositions?: Float32Array | ArrayLike<number>;
  whitePositions?: Float32Array | ArrayLike<number>;
  ribbonSamples?: number;
  ribbonReducer?: RibbonReducer;
  materialConfig?: Partial<SurfaceConfig>;
}

export class VolumeProjectedSurface extends NeuroSurface {
  private volumeTexture: VolumeTexture3D;
  private colormapTexture: THREE.DataTexture;
  private projectionMaterial: VolumeProjectionMaterial;
  private worldToIJKMatrix: THREE.Matrix4;
  private pialPositions: Float32Array | null;
  private whitePositions: Float32Array | null;
  private projectionMode: VolumeProjectionMode;
  private ribbonSamples: number;
  private ribbonReducer: RibbonReducer;

  constructor(geometry: SurfaceGeometry, options: VolumeProjectedSurfaceOptions) {
    super(geometry, null, [], options.materialConfig ?? {});

    const {
      volumeData,
      volumeDims,
      useHalfFloat = false,
      colormap = 'viridis',
      intensityRange = [0, 1],
      threshold = [0, 0],
      overlayOpacity = 1.0,
      baseColor = 0x888888,
      fillValue = 0.0,
      projectionMode = 'vertex',
      ribbonSamples = 7,
      ribbonReducer = 'mean'
    } = options;
    const normalizedIntensityRange = finitePair(intensityRange, 'intensityRange');
    const normalizedThreshold = finitePair(threshold, 'threshold');
    const normalizedOverlayOpacity = validateOpacity(overlayOpacity, 'overlayOpacity');
    const normalizedFillValue = finiteNumber(fillValue, 'fillValue');
    this.projectionMode = projectionMode;
    this.ribbonSamples = finiteNumber(ribbonSamples, 'ribbonSamples', {
      minimum: 1,
      maximum: 16,
      integer: true
    });
    this.ribbonReducer = ribbonReducer;
    this.pialPositions = options.pialPositions ? new Float32Array(options.pialPositions) : null;
    this.whitePositions = options.whitePositions ? new Float32Array(options.whitePositions) : null;
    this.validateRibbonAttributes();

    this.volumeTexture = new VolumeTexture3D(
      volumeData,
      volumeDims[0],
      volumeDims[1],
      volumeDims[2],
      { useHalfFloat }
    );

    this.worldToIJKMatrix = this.computeWorldToIJK(options);
    this.colormapTexture = createColormapTexture(colormap);

    this.projectionMaterial = new VolumeProjectionMaterial({
      volumeTexture: this.volumeTexture,
      worldToIJK: this.worldToIJKMatrix,
      colormapTexture: this.colormapTexture,
      config: {
        intensityRange: normalizedIntensityRange,
        threshold: normalizedThreshold,
        overlayOpacity: normalizedOverlayOpacity,
        baseColor,
        fillValue: normalizedFillValue,
        projectionMode,
        ribbonSamples: this.ribbonSamples,
        ribbonReducer: this.ribbonReducer
      }
    });

    this.createMesh();
  }

  createMesh(): THREE.Mesh {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(this.geometry.vertices, 3));
    geometry.setAttribute('pialPosition', new THREE.Float32BufferAttribute(this.pialPositions ?? this.geometry.vertices, 3));
    geometry.setAttribute('whitePosition', new THREE.Float32BufferAttribute(this.whitePositions ?? this.geometry.vertices, 3));

    const faceArray = (this.geometry.faces && this.geometry.faces.length > 0)
      ? this.geometry.faces
      : new Uint32Array(Array.from({ length: this.geometry.vertices.length / 3 }, (_, i) => i));
    geometry.setIndex(new THREE.Uint32BufferAttribute(faceArray, 1));

    this.mesh = new THREE.Mesh(geometry, this.projectionMaterial);
    this.computeNormals(geometry);
    return this.mesh;
  }

  updateColors(): void {
    // Colors are computed in the shader.
  }

  updateVolumeData(data: Float32Array | ArrayLike<number>): void {
    this.volumeTexture.updateData(data);
    this.emit('render:needed', { surface: this });
  }

  setIntensityRange(min: number, max: number): void {
    const range = finitePair([min, max], 'intensityRange');
    this.projectionMaterial.intensityRange = range;
    this.emit('material:updated', { surface: this });
    this.emit('render:needed', { surface: this });
  }

  setThreshold(min: number, max: number): void {
    const threshold = finitePair([min, max], 'threshold');
    this.projectionMaterial.threshold = threshold;
    this.emit('material:updated', { surface: this });
    this.emit('render:needed', { surface: this });
  }

  setOverlayOpacity(opacity: number): void {
    this.projectionMaterial.overlayOpacity = validateOpacity(opacity, 'overlayOpacity');
    this.emit('material:updated', { surface: this });
    this.emit('render:needed', { surface: this });
  }

  setBaseColor(color: THREE.ColorRepresentation): void {
    this.projectionMaterial.baseColor = color;
    this.emit('material:updated', { surface: this });
    this.emit('render:needed', { surface: this });
  }

  setColormap(name: string): void {
    if (this.colormapTexture) {
      this.colormapTexture.dispose();
    }
    this.colormapTexture = createColormapTexture(name);
    this.projectionMaterial.colormap = this.colormapTexture;
    this.emit('material:updated', { surface: this });
    this.emit('render:needed', { surface: this });
  }

  setWorldToIJK(matrix: THREE.Matrix4 | ArrayLike<number>): void {
    const nextMatrix = this.validatedMatrix(matrix, 'worldToIJK');
    this.worldToIJKMatrix = nextMatrix;
    this.projectionMaterial.setWorldToIJK(nextMatrix);
    this.emit('material:updated', { surface: this });
    this.emit('render:needed', { surface: this });
  }

  setProjectionMode(mode: VolumeProjectionMode): void {
    this.projectionMode = mode;
    this.projectionMaterial.setProjectionMode(mode);
    this.emit('material:updated', { surface: this });
    this.emit('render:needed', { surface: this });
  }

  setRibbonSampling(samples: number, reducer: RibbonReducer = this.ribbonReducer): void {
    this.ribbonSamples = finiteNumber(samples, 'ribbonSamples', {
      minimum: 1,
      maximum: 16,
      integer: true
    });
    this.ribbonReducer = reducer;
    this.projectionMaterial.setRibbonSampling(this.ribbonSamples, this.ribbonReducer);
    this.emit('material:updated', { surface: this });
    this.emit('render:needed', { surface: this });
  }

  setRibbonSurfaces(pial: Float32Array | ArrayLike<number>, white: Float32Array | ArrayLike<number>): void {
    const nextPial = new Float32Array(pial);
    const nextWhite = new Float32Array(white);
    this.validateRibbonPositions(nextPial, nextWhite);
    this.pialPositions = nextPial;
    this.whitePositions = nextWhite;
    if (this.mesh) {
      const geometry = this.mesh.geometry as THREE.BufferGeometry;
      geometry.setAttribute('pialPosition', new THREE.Float32BufferAttribute(this.pialPositions, 3));
      geometry.setAttribute('whitePosition', new THREE.Float32BufferAttribute(this.whitePositions, 3));
    }
    this.emit('geometry:updated', { surface: this });
    this.emit('render:needed', { surface: this });
  }

  static isSupported(
    renderer: THREE.WebGLRenderer,
    options: { requireLinearFiltering?: boolean; useHalfFloat?: boolean } = {}
  ): boolean {
    return VolumeTexture3D.isSupported(renderer, options);
  }

  dispose(): void {
    if (this.colormapTexture) {
      this.colormapTexture.dispose();
    }
    if (this.volumeTexture) {
      this.volumeTexture.dispose();
    }
    super.dispose();
  }

  private computeWorldToIJK(options: VolumeProjectedSurfaceOptions): THREE.Matrix4 {
    if (options.worldToIJK) {
      return this.validatedMatrix(options.worldToIJK, 'worldToIJK');
    }

    let voxelToWorld: THREE.Matrix4;
    if (options.affineMatrix) {
      voxelToWorld = this.validatedMatrix(options.affineMatrix, 'affineMatrix');
    } else {
      const voxelSize = (options.voxelSize ?? [1, 1, 1]).map((value, index) =>
        finiteNumber(value, `voxelSize[${index}]`, { minimum: 0, minimumExclusive: true })
      ) as [number, number, number];
      const origin = (options.volumeOrigin ?? [0, 0, 0]).map((value, index) =>
        finiteNumber(value, `volumeOrigin[${index}]`)
      ) as [number, number, number];
      voxelToWorld = new THREE.Matrix4().set(
        voxelSize[0], 0, 0, origin[0],
        0, voxelSize[1], 0, origin[1],
        0, 0, voxelSize[2], origin[2],
        0, 0, 0, 1
      );
    }

    return voxelToWorld.clone().invert();
  }

  private validateRibbonAttributes(): void {
    this.validateRibbonPositions(this.pialPositions, this.whitePositions);
  }

  private validateRibbonPositions(
    pial: Float32Array | null,
    white: Float32Array | null
  ): void {
    const expected = this.geometry.vertices.length;
    if ((pial && !white) || (!pial && white)) {
      throw new Error('VolumeProjectedSurface: ribbon projection requires both pialPositions and whitePositions');
    }
    if (pial && pial.length !== expected) {
      throw new Error('VolumeProjectedSurface: pialPositions length must match geometry vertices');
    }
    if (white && white.length !== expected) {
      throw new Error('VolumeProjectedSurface: whitePositions length must match geometry vertices');
    }
    for (const [name, positions] of [['pialPositions', pial], ['whitePositions', white]] as const) {
      if (!positions) continue;
      for (let index = 0; index < positions.length; index += 1) {
        finiteNumber(positions[index], `${name}[${index}]`);
      }
    }
  }

  private validatedMatrix(
    matrix: THREE.Matrix4 | ArrayLike<number>,
    parameter: string
  ): THREE.Matrix4 {
    const elements = matrix instanceof THREE.Matrix4 ? matrix.elements : Array.from(matrix);
    if (elements.length !== 16) {
      throw new RangeError(`${parameter} must contain exactly 16 elements.`);
    }
    const normalized = elements.map((value, index) => finiteNumber(value, `${parameter}[${index}]`));
    return new THREE.Matrix4().fromArray(normalized);
  }
}
