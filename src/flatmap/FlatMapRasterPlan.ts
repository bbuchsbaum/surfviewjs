import { checkBudget, GeometryError } from '../geometry/GeometryError';
import { runGeometrySync } from '../geometry/GeometryExecutor';
import { FlatMapChart } from './FlatMapChart';

export interface FlatMapRasterGrid {
  /** Bounds in chart coordinates, bottom-left to top-right. */
  bounds: readonly [number, number, number, number];
  width: number;
  height: number;
}

export interface FlatMapTile {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Owned output buffers. Rows run downwards; pixel coordinates refer to centers. */
export interface FlatMapRasterTile extends FlatMapTile {
  chart: FlatMapChart;
  grid: FlatMapRasterGrid;
  faces: Int32Array;
  /** Three weights in chart-face order per pixel, float64 for numerical sampling. */
  weights: Float64Array;
  byteLength: number;
}

export function validateRasterGrid(grid: FlatMapRasterGrid): void {
  if (!Number.isSafeInteger(grid.width) || !Number.isSafeInteger(grid.height) || grid.width < 1 || grid.height < 1 ||
      grid.width > 32768 || grid.height > 32768 || grid.bounds.length !== 4 || grid.bounds.some(x => !Number.isFinite(x)) ||
      !(grid.bounds[2] > grid.bounds[0]) || !(grid.bounds[3] > grid.bounds[1])) {
    throw new GeometryError('invalid-shape', 'Invalid flatmap raster grid');
  }
}

export function rasterPoint(grid: FlatMapRasterGrid, x: number, y: number): readonly [number, number] {
  return [grid.bounds[0] + (x + 0.5) / grid.width * (grid.bounds[2] - grid.bounds[0]),
    grid.bounds[3] - (y + 0.5) / grid.height * (grid.bounds[3] - grid.bounds[1])];
}

export function buildFlatMapRasterSteps(chart: FlatMapChart, grid: FlatMapRasterGrid, tile: FlatMapTile, budgetBytes?: number): Generator<void, FlatMapRasterTile, void> {
  return rasterSteps(chart, { ...grid, bounds: [...grid.bounds] }, { ...tile }, budgetBytes);
}
function* rasterSteps(chart: FlatMapChart, grid: FlatMapRasterGrid, tile: FlatMapTile, budgetBytes?: number): Generator<void, FlatMapRasterTile, void> {
  validateRasterGrid(grid);
  if (![tile.x, tile.y, tile.width, tile.height].every(Number.isSafeInteger) || tile.x < 0 || tile.y < 0 ||
      tile.width < 1 || tile.height < 1 || tile.x + tile.width > grid.width || tile.y + tile.height > grid.height) {
    throw new GeometryError('invalid-shape', 'Tile must lie inside its raster grid');
  }
  const count = tile.width * tile.height;
  checkBudget(count * 28, budgetBytes);
  const faces = new Int32Array(count).fill(-1), weights = new Float64Array(count * 3);
  for (let y = 0; y < tile.height; y++) {
    for (let x = 0; x < tile.width; x++) {
      const point = rasterPoint(grid, tile.x + x, tile.y + y), hit = chart.locate(point[0], point[1]);
      if (hit) { const i = y * tile.width + x; faces[i] = hit.chartFace; weights.set(hit.weights, i * 3); }
    }
    yield;
  }
  return { ...tile, chart, grid: { ...grid, bounds: [...grid.bounds] }, faces, weights, byteLength: faces.byteLength + weights.byteLength };
}

export function buildFlatMapRaster(chart: FlatMapChart, grid: FlatMapRasterGrid, tile: FlatMapTile, budgetBytes?: number): FlatMapRasterTile {
  return runGeometrySync(buildFlatMapRasterSteps(chart, grid, tile, budgetBytes));
}
