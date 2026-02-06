import * as THREE from 'three';
import { NeuroSurface, SurfaceGeometry, SurfaceConfig } from '../classes';
import { VolumeProjectionMaterial } from '../materials/VolumeProjectionMaterial';
import { VolumeTexture3D } from '../textures/VolumeTexture3D';
import { createColormapTexture } from '../textures/createColormapTexture';

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
  materialConfig?: Partial<SurfaceConfig>;
}

export class VolumeProjectedSurface extends NeuroSurface {
  private volumeTexture: VolumeTexture3D;
  private colormapTexture: THREE.DataTexture;
  private projectionMaterial: VolumeProjectionMaterial;
  private worldToIJKMatrix: THREE.Matrix4;

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
      fillValue = 0.0
    } = options;

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
        intensityRange,
        threshold,
        overlayOpacity,
        baseColor,
        fillValue
      }
    });

    this.createMesh();
  }

  createMesh(): THREE.Mesh {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(this.geometry.vertices, 3));

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
    this.projectionMaterial.intensityRange = [min, max];
    this.emit('material:updated', { surface: this });
    this.emit('render:needed', { surface: this });
  }

  setThreshold(min: number, max: number): void {
    this.projectionMaterial.threshold = [min, max];
    this.emit('material:updated', { surface: this });
    this.emit('render:needed', { surface: this });
  }

  setOverlayOpacity(opacity: number): void {
    this.projectionMaterial.overlayOpacity = opacity;
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
    this.worldToIJKMatrix = matrix instanceof THREE.Matrix4
      ? matrix.clone()
      : new THREE.Matrix4().fromArray(Array.from(matrix));
    this.projectionMaterial.setWorldToIJK(this.worldToIJKMatrix);
    this.emit('material:updated', { surface: this });
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
      return options.worldToIJK instanceof THREE.Matrix4
        ? options.worldToIJK.clone()
        : new THREE.Matrix4().fromArray(Array.from(options.worldToIJK));
    }

    let voxelToWorld: THREE.Matrix4;
    if (options.affineMatrix) {
      voxelToWorld = options.affineMatrix instanceof THREE.Matrix4
        ? options.affineMatrix.clone()
        : new THREE.Matrix4().fromArray(Array.from(options.affineMatrix));
    } else {
      const voxelSize = options.voxelSize ?? [1, 1, 1];
      const origin = options.volumeOrigin ?? [0, 0, 0];
      voxelToWorld = new THREE.Matrix4().set(
        voxelSize[0], 0, 0, origin[0],
        0, voxelSize[1], 0, origin[1],
        0, 0, voxelSize[2], origin[2],
        0, 0, 0, 1
      );
    }

    return voxelToWorld.clone().invert();
  }
}

