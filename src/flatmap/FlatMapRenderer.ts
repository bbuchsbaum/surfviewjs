import * as THREE from 'three';
import { GeometryError, checkBudget } from '../geometry/GeometryError';
import { FlatMapField } from './FlatMapFieldMaterial';
import { flatMapPixel, normalizeFlatMapPresentation, type FlatMapPresentation } from './FlatMapPresentation';
import { validateRasterGrid, type FlatMapRasterGrid, type FlatMapTile } from './FlatMapRasterPlan';
import type { FlatMapSamples } from './FlatMapSamplingPlan';

export interface FlatMapRenderer {
  readonly canvas: HTMLCanvasElement;
  readonly backend: 'canvas2d' | 'webgl2';
  setGrid(grid: FlatMapRasterGrid): void;
  setPresentation(presentation: FlatMapPresentation): void;
  updateTile(tile: FlatMapTile, values: FlatMapSamples): void;
  setAnatomy(shade: ArrayLike<number>): void;
  render(): void;
  dispose(): void;
}

export class CanvasFlatMapRenderer implements FlatMapRenderer {
  readonly backend = 'canvas2d' as const;
  readonly canvas: HTMLCanvasElement;
  private readonly context: CanvasRenderingContext2D;
  private grid: FlatMapRasterGrid | undefined;
  private presentation: Required<FlatMapPresentation>;
  private data = new Float64Array();
  private anatomy = new Float32Array();
  private disposed = false;
  constructor(presentation: FlatMapPresentation, canvas = document.createElement('canvas'), readonly budgetBytes = 128 * 1024 * 1024) {
    this.canvas = canvas;
    const context = canvas.getContext('2d'); if (!context) throw new GeometryError('invalid-domain', 'Canvas2D unavailable');
    this.context = context; this.presentation = normalizeFlatMapPresentation(presentation);
  }
  setGrid(grid: FlatMapRasterGrid): void {
    this.checkAlive(); validateRasterGrid(grid); checkBudget(grid.width * grid.height * 32, this.budgetBytes);
    this.grid = { ...grid, bounds: [...grid.bounds] }; this.canvas.width = grid.width; this.canvas.height = grid.height;
    this.data = new Float64Array(grid.width * grid.height * 3);
    this.anatomy = new Float32Array(grid.width * grid.height).fill(1);
  }
  setPresentation(input: FlatMapPresentation): void { this.checkAlive(); this.presentation = normalizeFlatMapPresentation(input); this.render(); }
  updateTile(tile: FlatMapTile, values: FlatMapSamples): void {
    this.checkAlive(); const grid = this.grid;
    if (!grid || tile.x < 0 || tile.y < 0 || tile.x + tile.width > grid.width || tile.y + tile.height > grid.height || values.values.length !== tile.width * tile.height) throw new GeometryError('invalid-shape', 'Invalid tile');
    for (let y = 0; y < tile.height; y++) for (let x = 0; x < tile.width; x++) {
      const i = y * tile.width + x, j = ((tile.y + y) * grid.width + tile.x + x) * 3;
      this.data[j] = values.values[i]!; this.data[j + 1] = values.coverage[i]!; this.data[j + 2] = values.status[i]!;
    }
    this.paint(tile);
  }
  setAnatomy(shade: ArrayLike<number>): void {
    this.checkAlive();
    if (shade.length !== this.anatomy.length) throw new GeometryError('invalid-shape', 'Anatomical underlay differs from field');
    for (let i = 0; i < shade.length; i++) if (!Number.isFinite(shade[i]) || shade[i]! < 0 || shade[i]! > 2) throw new GeometryError('invalid-shape', 'Underlay shade must be finite in [0,2]');
    this.anatomy.set(shade); this.render();
  }
  private paint(tile: FlatMapTile): void {
    if (!this.grid) return;
    const image = this.context.createImageData(tile.width, tile.height);
    for (let y = 0; y < tile.height; y++) for (let x = 0; x < tile.width; x++) {
      const i = ((tile.y + y) * this.grid.width + tile.x + x) * 3;
      const color = flatMapPixel(this.data[i]!, this.data[i + 1]!, this.data[i + 2]!, tile.x + x, tile.y + y, this.presentation, this.anatomy[i / 3]!);
      for (let k = 0; k < 4; k++) image.data[(y * tile.width + x) * 4 + k] = Math.round(color[k]! * 255);
    }
    this.context.putImageData(image, tile.x, tile.y);
  }
  render(): void { this.checkAlive(); if (this.grid) this.paint({ x: 0, y: 0, width: this.grid.width, height: this.grid.height }); }
  private checkAlive(): void { if (this.disposed) throw new GeometryError('disposed', 'Renderer disposed'); }
  dispose(): void { if (!this.disposed) { this.disposed = true; this.data = new Float64Array(); this.anatomy = new Float32Array(); this.canvas.width = this.canvas.height = 0; } }
}

export class WebGLFlatMapRenderer implements FlatMapRenderer {
  readonly backend = 'webgl2' as const;
  readonly canvas: HTMLCanvasElement;
  readonly field: FlatMapField;
  readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 2);
  private readonly plane: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  private disposed = false;
  constructor(presentation: FlatMapPresentation, options: { canvas?: HTMLCanvasElement; field?: FlatMapField; budgetBytes?: number } = {}) {
    this.canvas = options.canvas ?? document.createElement('canvas');
    this.field = options.field ?? new FlatMapField(presentation, options.budgetBytes);
    this.ownsField = !options.field;
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, alpha: true, antialias: false, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(1); this.renderer.setClearColor(0, 0); this.renderer.toneMapping = THREE.NoToneMapping;
    this.plane = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.field.createMaterial());
    this.plane.position.z = -1; this.scene.add(this.plane);
    this.canvas.addEventListener('webglcontextrestored', this.restored);
  }
  private readonly ownsField: boolean;
  private restored = () => { if (!this.disposed) this.render(); };
  setGrid(grid: FlatMapRasterGrid): void {
    this.checkAlive(); this.field.setGrid(grid); this.renderer.setSize(grid.width, grid.height, false); this.render();
  }
  setPresentation(input: FlatMapPresentation): void { this.checkAlive(); this.field.setPresentation(input); this.render(); }
  setAnatomy(shade: ArrayLike<number>): void { this.checkAlive(); this.field.setAnatomy(shade); this.render(); }
  updateTile(tile: FlatMapTile, values: FlatMapSamples): void { this.checkAlive(); this.field.updateTile(tile, values); this.render(); }
  render(): void { this.checkAlive(); this.renderer.render(this.scene, this.camera); }
  private checkAlive(): void { if (this.disposed) throw new GeometryError('disposed', 'Renderer disposed'); }
  dispose(): void {
    if (this.disposed) return; this.disposed = true;
    this.canvas.removeEventListener('webglcontextrestored', this.restored);
    this.plane.geometry.dispose(); this.plane.material.dispose(); this.renderer.dispose(); this.renderer.forceContextLoss();
    if (this.ownsField) this.field.dispose();
  }
}
