import * as THREE from 'three';
import { EventEmitter } from '../EventEmitter';
import { checkBudget, GeometryError } from '../geometry/GeometryError';
import { FLATMAP_COLOR_GLSL, normalizeFlatMapPresentation, type FlatMapPresentation } from './FlatMapPresentation';
import { validateRasterGrid, type FlatMapRasterGrid, type FlatMapTile } from './FlatMapRasterPlan';
import type { FlatMapSamples } from './FlatMapSamplingPlan';

/** Shared numeric field, palette and uniforms for 2D and 3D presentation. */
export class FlatMapField extends EventEmitter<{ change: void }> {
  readonly uniforms: Record<string, THREE.IUniform>;
  private data = new Float32Array(4);
  private texture: THREE.DataTexture;
  private palette: THREE.DataTexture;
  private disposed = false;
  private currentGrid: FlatMapRasterGrid | undefined;
  readonly budgetBytes: number;

  constructor(presentation: FlatMapPresentation, budgetBytes = 128 * 1024 * 1024) {
    super();
    this.budgetBytes = budgetBytes; checkBudget(0, budgetBytes);
    this.texture = this.makeTexture(this.data, 1, 1);
    this.palette = this.makeTexture(new Float32Array(4), 1, 1);
    this.uniforms = { uField: { value: this.texture }, uPalette: { value: this.palette }, uPaletteSize: { value: 1 },
      uRange: { value: new THREE.Vector2() }, uThreshold: { value: new THREE.Vector2() }, uOpacity: { value: 1 },
      uBounds: { value: new THREE.Vector4() }, uCoverage: { value: true }, uUnderlay: { value: new THREE.Vector3() }, uResolution: { value: new THREE.Vector2(1, 1) } };
    this.setPresentation(presentation);
  }
  get grid(): FlatMapRasterGrid | undefined { return this.currentGrid; }
  get byteLength(): number { return this.data.byteLength + (this.palette.image.data as Float32Array).byteLength; }
  get isDisposed(): boolean { return this.disposed; }
  private makeTexture(data: Float32Array, width: number, height: number): THREE.DataTexture {
    const texture = new THREE.DataTexture(data, width, height, THREE.RGBAFormat, THREE.FloatType);
    texture.minFilter = texture.magFilter = THREE.NearestFilter;
    texture.generateMipmaps = false; texture.flipY = false; texture.colorSpace = THREE.NoColorSpace; texture.needsUpdate = true;
    return texture;
  }
  setGrid(grid: FlatMapRasterGrid): void {
    this.checkAlive(); validateRasterGrid(grid); checkBudget(grid.width * grid.height * 16, this.budgetBytes);
    this.currentGrid = { ...grid, bounds: [...grid.bounds] };
    this.texture.dispose(); this.data = new Float32Array(grid.width * grid.height * 4);
    for (let i = 3; i < this.data.length; i += 4) this.data[i] = 1;
    this.texture = this.makeTexture(this.data, grid.width, grid.height);
    (this.uniforms.uBounds!.value as THREE.Vector4).fromArray(grid.bounds);
    this.uniforms.uField!.value = this.texture; (this.uniforms.uResolution!.value as THREE.Vector2).set(grid.width, grid.height);
    this.emit('change');
  }
  setPresentation(input: FlatMapPresentation): void {
    this.checkAlive(); const p = normalizeFlatMapPresentation(input), colors = p.colorMap.getColors();
    const data = new Float32Array(colors.length * 4);
    colors.forEach((c, i) => data.set([c[0], c[1], c[2], c[3] ?? 1], i * 4));
    this.palette.dispose(); this.palette = this.makeTexture(data, colors.length, 1);
    this.uniforms.uPalette!.value = this.palette; this.uniforms.uPaletteSize!.value = colors.length;
    (this.uniforms.uRange!.value as THREE.Vector2).fromArray(p.colorMap.getRange());
    (this.uniforms.uThreshold!.value as THREE.Vector2).fromArray(p.colorMap.getThreshold());
    (this.uniforms.uUnderlay!.value as THREE.Vector3).fromArray(p.underlay);
    this.uniforms.uOpacity!.value = p.opacity; this.uniforms.uCoverage!.value = p.showCoverage; this.emit('change');
  }
  updateTile(tile: FlatMapTile, samples: FlatMapSamples): void {
    this.checkAlive(); const grid = this.currentGrid;
    if (!grid || tile.x < 0 || tile.y < 0 || tile.x + tile.width > grid.width || tile.y + tile.height > grid.height || samples.values.length !== tile.width * tile.height) {
      throw new GeometryError('invalid-shape', 'Tile does not fit the field');
    }
    for (let y = 0; y < tile.height; y++) {
      const row = ((tile.y + y) * grid.width + tile.x) * 4;
      for (let x = 0; x < tile.width; x++) {
        const i = y * tile.width + x, j = row + x * 4, value = samples.values[i]!;
        this.data[j] = samples.valid[i] ? value : 0;
        if (samples.valid[i] && !Number.isFinite(this.data[j])) throw new GeometryError('invalid-shape', 'Scalar overflows float32 presentation');
        this.data[j + 1] = samples.coverage[i]!; this.data[j + 2] = samples.status[i]!;
      }
      this.texture.addUpdateRange(row, tile.width * 4);
    }
    this.texture.needsUpdate = true; this.emit('change');
  }
  setAnatomy(shade: ArrayLike<number>): void {
    this.checkAlive();
    if (shade.length * 4 !== this.data.length) throw new GeometryError('invalid-shape', 'Anatomical underlay differs from field');
    for (let i = 0; i < shade.length; i++) if (!Number.isFinite(shade[i]) || shade[i]! < 0 || shade[i]! > 2) throw new GeometryError('invalid-shape', 'Underlay shade must be finite in [0,2]');
    for (let i = 0; i < shade.length; i++) this.data[i * 4 + 3] = shade[i]!;
    this.texture.clearUpdateRanges(); this.texture.needsUpdate = true; this.emit('change');
  }
  /** A copy for evidence and exports, never the live texture storage. */
  copyPixels(): Float32Array { return this.data.slice(); }
  createMaterial(): THREE.ShaderMaterial {
    this.checkAlive();
    return new THREE.ShaderMaterial({ uniforms: this.uniforms, depthTest: false, depthWrite: false, transparent: true,
      vertexShader: 'varying vec2 vChartUv; void main(){vChartUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
      fragmentShader: `varying vec2 vChartUv; ${FLATMAP_COLOR_GLSL}\nvoid main(){gl_FragColor=flatMapColor(vec2(vChartUv.x,1.-vChartUv.y),1.);}`,
      toneMapped: false });
  }
  private checkAlive(): void { if (this.disposed) throw new GeometryError('disposed', 'Flatmap field disposed'); }
  dispose(): void { if (!this.disposed) { this.disposed = true; this.texture.dispose(); this.palette.dispose(); this.data = new Float32Array(); this.removeAllListeners(); } }
}
