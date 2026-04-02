import * as THREE from 'three';
import { debugLog } from '../debug';

/**
 * Result of a GPU pick operation
 */
export interface GPUPickResult {
  /** ID of the picked surface (null if no hit) */
  surfaceId: string | null;
  /** Index of the picked vertex (null if no hit) */
  vertexIndex: number | null;
  /** World-space position of the pick point (null if no hit) */
  point: THREE.Vector3 | null;
  /** Index of the picked face (null if no hit) */
  faceIndex: number | null;
}

export interface FacePickGeometry {
  geometry: THREE.BufferGeometry;
  faceCount: number;
}

/**
 * Shader material for encoding vertex indices into RGB colors.
 *
 * Each vertex gets a unique color based on its index:
 * - R channel: bits 0-7 (low byte)
 * - G channel: bits 8-15 (mid byte)
 * - B channel: bits 16-23 (high byte)
 *
 * This allows encoding up to 16,777,216 vertices (2^24).
 */
const pickingVertexShader = `
  attribute float faceId;
  varying vec3 vPickColor;

  void main() {
    // Encode face index into RGB. Every vertex in a face gets the same value,
    // so the rasterized fragment color remains stable across the triangle.
    float id = faceId;
    float r = mod(id, 256.0) / 255.0;
    float g = mod(floor(id / 256.0), 256.0) / 255.0;
    float b = mod(floor(id / 65536.0), 256.0) / 255.0;
    vPickColor = vec3(r, g, b);

    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const pickingFragmentShader = `
  varying vec3 vPickColor;

  void main() {
    gl_FragColor = vec4(vPickColor, 1.0);
  }
`;

/**
 * Surface info stored for GPU picking
 */
interface PickableSurface {
  /** Original mesh */
  mesh: THREE.Mesh;
  /** Pick mesh with ID-encoded colors */
  pickMesh: THREE.Mesh;
  /** Surface ID string */
  id: string;
  /** First globally encoded face ID assigned to this surface */
  faceBaseId: number;
  /** Number of faces encoded for this surface */
  faceCount: number;
}

/**
 * Build a pick geometry that carries a stable face ID per triangle.
 *
 * The source geometry is converted to a non-indexed representation so each
 * triangle has its own three vertices. That lets us attach a constant ID to
 * every vertex in the face without interpolation artifacts.
 */
export function buildFacePickGeometry(
  geometry: THREE.BufferGeometry,
  faceBaseId: number = 0
): FacePickGeometry {
  const pickGeometry = geometry.index ? geometry.toNonIndexed() : geometry.clone();
  const position = pickGeometry.getAttribute('position') as THREE.BufferAttribute | undefined;
  if (!position) {
    throw new Error('GPUPicker: geometry is missing a position attribute');
  }

  const faceCount = Math.floor(position.count / 3);
  const faceIds = new Float32Array(position.count);

  for (let faceIndex = 0; faceIndex < faceCount; faceIndex++) {
    const encodedId = faceBaseId + faceIndex;
    const offset = faceIndex * 3;
    faceIds[offset] = encodedId;
    faceIds[offset + 1] = encodedId;
    faceIds[offset + 2] = encodedId;
  }

  pickGeometry.setAttribute('faceId', new THREE.BufferAttribute(faceIds, 1));
  return { geometry: pickGeometry, faceCount };
}

/**
 * Return the original geometry vertex indices for a face.
 */
export function getFaceVertexIndices(
  geometry: THREE.BufferGeometry,
  faceIndex: number
): [number, number, number] | null {
  const position = geometry.getAttribute('position') as THREE.BufferAttribute | undefined;
  if (!position || faceIndex < 0) {
    return null;
  }

  if (geometry.index) {
    const index = geometry.index.array as ArrayLike<number>;
    const offset = faceIndex * 3;
    if (offset + 2 >= geometry.index.count) {
      return null;
    }
    return [index[offset], index[offset + 1], index[offset + 2]];
  }

  const offset = faceIndex * 3;
  if (offset + 2 >= position.count) {
    return null;
  }
  return [offset, offset + 1, offset + 2];
}

/**
 * Intersect a ray against a specific face and choose the nearest face vertex
 * to the intersection point.
 */
export function pickNearestVertexOnFace(
  mesh: THREE.Mesh,
  faceIndex: number,
  ray: THREE.Ray
): { point: THREE.Vector3 | null; vertexIndex: number | null } {
  const geometry = mesh.geometry as THREE.BufferGeometry;
  const position = geometry.getAttribute('position') as THREE.BufferAttribute | undefined;
  const vertexIndices = getFaceVertexIndices(geometry, faceIndex);
  if (!position || !vertexIndices) {
    return { point: null, vertexIndex: null };
  }

  const [aIndex, bIndex, cIndex] = vertexIndices;
  const a = new THREE.Vector3(
    position.getX(aIndex),
    position.getY(aIndex),
    position.getZ(aIndex)
  ).applyMatrix4(mesh.matrixWorld);
  const b = new THREE.Vector3(
    position.getX(bIndex),
    position.getY(bIndex),
    position.getZ(bIndex)
  ).applyMatrix4(mesh.matrixWorld);
  const c = new THREE.Vector3(
    position.getX(cIndex),
    position.getY(cIndex),
    position.getZ(cIndex)
  ).applyMatrix4(mesh.matrixWorld);

  const point = ray.intersectTriangle(a, b, c, false, new THREE.Vector3());
  if (!point) {
    return { point: null, vertexIndex: null };
  }

  let vertexIndex = aIndex;
  let closestDistance = point.distanceToSquared(a);

  const bDistance = point.distanceToSquared(b);
  if (bDistance < closestDistance) {
    closestDistance = bDistance;
    vertexIndex = bIndex;
  }

  const cDistance = point.distanceToSquared(c);
  if (cDistance < closestDistance) {
    vertexIndex = cIndex;
  }

  return { point, vertexIndex };
}

/**
 * GPU-based picking for fast, accurate vertex selection on large meshes.
 *
 * Uses render-to-texture to encode vertex indices into colors, then reads
 * the pixel under the mouse to determine the exact picked vertex.
 *
 * Benefits over raycasting:
 * - O(1) picking time regardless of mesh size
 * - Exact vertex index (no face-to-vertex approximation needed)
 * - Works correctly with complex shaders and deformations
 *
 * @example
 * ```typescript
 * const picker = new GPUPicker(renderer);
 *
 * // Register surfaces
 * picker.addSurface('brain', brainMesh);
 *
 * // Pick at mouse position
 * const result = picker.pick(mouseX, mouseY, camera);
 * if (result.vertexIndex !== null) {
 *   console.log(`Picked vertex ${result.vertexIndex} on ${result.surfaceId}`);
 * }
 * ```
 */
export class GPUPicker {
  private renderer: THREE.WebGLRenderer;
  private pickingTexture: THREE.WebGLRenderTarget;
  private pixelBuffer: Uint8Array;
  private pickScene: THREE.Scene;
  private surfaces: Map<string, PickableSurface> = new Map();
  private pickMaterial: THREE.ShaderMaterial;
  private enabled: boolean = true;
  private lastPickTime: number = 0;
  private pickThrottleMs: number = 16; // ~60fps max pick rate
  private nextFaceBaseId: number = 0;

  /** Clear color for no-hit (index = -1 encoded as max value) */
  private static readonly NO_HIT_COLOR = new THREE.Color(1, 1, 1);
  private static readonly NO_HIT_ID = 0xFFFFFF; // 16777215

  /** Reusable objects to avoid per-pick allocations */
  private readonly savedClearColor = new THREE.Color();
  private readonly pickNdc = new THREE.Vector2();
  private readonly pickRaycaster = new THREE.Raycaster();
  private pickCamera: THREE.PerspectiveCamera | THREE.OrthographicCamera | null = null;

  constructor(renderer: THREE.WebGLRenderer) {
    this.renderer = renderer;

    // Create 1x1 pixel render target
    this.pickingTexture = new THREE.WebGLRenderTarget(1, 1, {
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      format: THREE.RGBAFormat,
      type: THREE.UnsignedByteType
    });

    this.pixelBuffer = new Uint8Array(4);

    // Create picking scene
    this.pickScene = new THREE.Scene();
    this.pickScene.background = GPUPicker.NO_HIT_COLOR;

    // Create shared picking material
    this.pickMaterial = new THREE.ShaderMaterial({
      vertexShader: pickingVertexShader,
      fragmentShader: pickingFragmentShader,
      side: THREE.DoubleSide
    });

    debugLog('GPUPicker initialized');
  }

  /**
   * Add a surface mesh to the picker.
   * Creates a pick mesh with vertex ID attributes.
   */
  addSurface(id: string, mesh: THREE.Mesh): void {
    if (this.surfaces.has(id)) {
      this.removeSurface(id);
    }

    const geometry = mesh.geometry as THREE.BufferGeometry;
    const faceBaseId = this.nextFaceBaseId;
    const { geometry: pickGeometry, faceCount } = buildFacePickGeometry(geometry, faceBaseId);
    const maxEncodedFaceId = faceBaseId + faceCount - 1;
    if (maxEncodedFaceId >= GPUPicker.NO_HIT_ID) {
      pickGeometry.dispose();
      throw new Error('GPUPicker: face ID budget exceeded');
    }

    // Create pick mesh with shared material
    const pickMesh = new THREE.Mesh(pickGeometry, this.pickMaterial);
    pickMesh.matrixAutoUpdate = false; // We'll sync manually

    this.pickScene.add(pickMesh);

    this.surfaces.set(id, {
      mesh,
      pickMesh,
      id,
      faceBaseId,
      faceCount
    });
    this.nextFaceBaseId += faceCount;

    debugLog(`GPUPicker: Added surface "${id}" with ${faceCount} faces`);
  }

  /**
   * Remove a surface from the picker.
   */
  removeSurface(id: string): boolean {
    const surface = this.surfaces.get(id);
    if (!surface) return false;

    this.pickScene.remove(surface.pickMesh);
    surface.pickMesh.geometry.dispose();
    this.surfaces.delete(id);

    debugLog(`GPUPicker: Removed surface "${id}"`);
    return true;
  }

  /**
   * Update pick meshes to match their original mesh transforms.
   * Call this before picking if meshes have moved.
   */
  syncTransforms(): void {
    for (const surface of this.surfaces.values()) {
      surface.mesh.updateMatrixWorld(true);
      surface.pickMesh.matrix.copy(surface.mesh.matrixWorld);
      surface.pickMesh.matrixWorld.copy(surface.mesh.matrixWorld);
      surface.pickMesh.visible = surface.mesh.visible;
    }
  }

  /**
   * Enable or disable GPU picking.
   */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  /**
   * Check if GPU picking is enabled.
   */
  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Set the minimum time between pick operations (for throttling).
   */
  setThrottleMs(ms: number): void {
    this.pickThrottleMs = Math.max(0, ms);
  }

  /**
   * Perform GPU picking at the given screen coordinates.
   *
   * @param cssX - X coordinate in CSS pixels (from event.clientX)
   * @param cssY - Y coordinate in CSS pixels (from event.clientY)
   * @param camera - The camera to pick from
   * @param rect - Optional bounding rect of the canvas (auto-detected if not provided)
   * @returns Pick result with surface ID, vertex index, and world position
   */
  pick(
    cssX: number,
    cssY: number,
    camera: THREE.Camera,
    rect?: DOMRect
  ): GPUPickResult {
    // Return no-hit if disabled
    if (!this.enabled) {
      return { surfaceId: null, vertexIndex: null, point: null, faceIndex: null };
    }

    // Throttle picks
    const now = performance.now();
    if (now - this.lastPickTime < this.pickThrottleMs) {
      return { surfaceId: null, vertexIndex: null, point: null, faceIndex: null };
    }
    this.lastPickTime = now;

    // Get canvas rect if not provided
    if (!rect) {
      rect = this.renderer.domElement.getBoundingClientRect();
    }

    // Convert CSS coordinates to canvas-relative
    const canvasX = cssX - rect.left;
    const canvasY = cssY - rect.top;

    // Sync pick mesh transforms
    this.syncTransforms();

    // Set up camera view offset for single-pixel rendering
    const pixelRatio = this.renderer.getPixelRatio();
    const context = this.renderer.getContext();
    const width = context.drawingBufferWidth;
    const height = context.drawingBufferHeight;

    // Reuse pick camera to avoid per-pick allocation
    if (!this.pickCamera || this.pickCamera.type !== camera.type) {
      this.pickCamera = camera.clone() as THREE.PerspectiveCamera | THREE.OrthographicCamera;
    } else {
      this.pickCamera.copy(camera as any);
    }
    const pickCamera = this.pickCamera;

    if ('setViewOffset' in pickCamera) {
      pickCamera.setViewOffset(
        width,
        height,
        Math.floor(canvasX * pixelRatio),
        Math.floor(canvasY * pixelRatio),
        1,
        1
      );
    }

    // Store current state
    const currentRenderTarget = this.renderer.getRenderTarget();
    this.renderer.getClearColor(this.savedClearColor);
    const currentClearAlpha = this.renderer.getClearAlpha();

    // Render pick scene to 1x1 texture
    this.renderer.setRenderTarget(this.pickingTexture);
    this.renderer.setClearColor(GPUPicker.NO_HIT_COLOR, 1);
    this.renderer.clear();
    this.renderer.render(this.pickScene, pickCamera);

    // Read the pixel
    this.renderer.readRenderTargetPixels(
      this.pickingTexture,
      0,
      0,
      1,
      1,
      this.pixelBuffer
    );

    // Restore state
    this.renderer.setRenderTarget(currentRenderTarget);
    this.renderer.setClearColor(this.savedClearColor, currentClearAlpha);

    // Decode face index from RGB
    const r = this.pixelBuffer[0];
    const g = this.pixelBuffer[1];
    const b = this.pixelBuffer[2];
    const encodedFaceId = r | (g << 8) | (b << 16);

    // Check for no-hit
    if (encodedFaceId === GPUPicker.NO_HIT_ID) {
      return { surfaceId: null, vertexIndex: null, point: null, faceIndex: null };
    }

    const surface = this.findSurfaceByFaceId(encodedFaceId);
    if (!surface) {
      return { surfaceId: null, vertexIndex: null, point: null, faceIndex: null };
    }

    const faceIndex = encodedFaceId - surface.faceBaseId;
    this.pickNdc.set(
      (canvasX / rect.width) * 2 - 1,
      -(canvasY / rect.height) * 2 + 1
    );
    this.pickRaycaster.setFromCamera(
      this.pickNdc,
      camera as THREE.PerspectiveCamera | THREE.OrthographicCamera
    );

    const hit = pickNearestVertexOnFace(surface.mesh, faceIndex, this.pickRaycaster.ray);
    return {
      surfaceId: surface.id,
      vertexIndex: hit.vertexIndex,
      point: hit.point,
      faceIndex
    };
  }

  /**
   * Pick using normalized device coordinates (-1 to 1).
   */
  pickNDC(
    ndcX: number,
    ndcY: number,
    camera: THREE.Camera
  ): GPUPickResult {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const cssX = ((ndcX + 1) / 2) * rect.width + rect.left;
    const cssY = ((-ndcY + 1) / 2) * rect.height + rect.top;
    return this.pick(cssX, cssY, camera, rect);
  }

  private findSurfaceByFaceId(encodedFaceId: number): PickableSurface | null {
    for (const surface of this.surfaces.values()) {
      if (
        encodedFaceId >= surface.faceBaseId &&
        encodedFaceId < surface.faceBaseId + surface.faceCount
      ) {
        return surface;
      }
    }
    return null;
  }

  /**
   * Check if the renderer supports GPU picking.
   */
  static isSupported(renderer: THREE.WebGLRenderer): boolean {
    const gl = renderer.getContext();
    return gl !== null && (gl instanceof WebGLRenderingContext || gl instanceof WebGL2RenderingContext);
  }

  /**
   * Dispose of all resources.
   */
  dispose(): void {
    this.pickingTexture.dispose();
    this.pickMaterial.dispose();

    for (const surface of this.surfaces.values()) {
      surface.pickMesh.geometry.dispose();
    }
    this.surfaces.clear();

    debugLog('GPUPicker disposed');
  }
}

export default GPUPicker;
