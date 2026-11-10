import type { FlatMapView } from '../FlatMapView';
import { GeometryError } from '../geometry/GeometryError';
import { FlatMapController } from './FlatMapController';
import type { FlatMapRenderer } from './FlatMapRenderer';
import type { FlatMapRasterGrid } from './FlatMapRasterPlan';
import { chartStorage } from './FlatMapChart';

/** A view attachment borrows its controller/renderer; detach does not dispose shared resources. */
export class FlatMapViewAttachment {
  private detached = false;
  private preparation: AbortController | undefined;
  private readonly unselect: () => void;
  constructor(readonly view: FlatMapView, readonly controller: FlatMapController, readonly renderer: FlatMapRenderer) {
    const c = chartStorage(controller.chart);
    if (view.vertices.length !== controller.chart.vertexCount * 3 || view.faces.length !== c.faces.length ||
        c.faces.some((v, i) => view.faces[i] !== v) || c.xy.some((x, i) => Math.abs(view.vertices[Math.floor(i / 2) * 3 + i % 2]! - x) > Math.max(1, Math.abs(x)) * 1e-6)) {
      throw new GeometryError('invalid-domain', 'FlatMapView must use the registered chart coordinates and faces');
    }
    this.unselect = controller.on('selection', () => view.render());
    view.attachQuantitative(this);
  }
  async prepare(width = 512, height?: number): Promise<void> {
    if (this.detached) throw new GeometryError('disposed', 'Flatmap attachment detached');
    const bounds = this.controller.chart.bounds;
    const grid: FlatMapRasterGrid = { width, height: height ?? Math.max(1, Math.round(width * (bounds[3] - bounds[1]) / (bounds[2] - bounds[0]))), bounds };
    this.renderer.setGrid(grid);
    this.preparation?.abort();
    const preparation = new AbortController();
    this.preparation = preparation;
    try {
      await this.controller.render(grid, (tile, samples) => {
        if (this.detached) return;
        this.renderer.updateTile(tile, samples); this.view.render();
      }, preparation.signal);
    } finally { if (this.preparation === preparation) this.preparation = undefined; }
  }
  paint(context: CanvasRenderingContext2D): void {
    const [x0, y0, x1, y1] = this.controller.chart.bounds;
    const a = this.view.projectPoint(x0, y1), b = this.view.projectPoint(x1, y0);
    context.imageSmoothingEnabled = false;
    context.drawImage(this.renderer.canvas, a.x, a.y, b.x - a.x, b.y - a.y);
  }
  paintSelection(context: CanvasRenderingContext2D, color: string, radius: number): void {
    const selected = this.controller.getSelection(); if (!selected) return;
    context.strokeStyle = color; context.lineWidth = 2;
    for (const [x, y] of this.controller.chart.chartPoints(selected)) {
      const point = this.view.projectPoint(x, y); context.beginPath(); context.arc(point.x, point.y, radius, 0, Math.PI * 2); context.stroke();
    }
  }
  hit(x: number, y: number) { const point = this.view.unprojectPoint(x, y); return this.controller.chart.locate(point.x, point.y); }
  pickVertex(x: number, y: number): number | null {
    const hit = this.hit(x, y); if (!hit) return null;
    const corner = hit.weights.indexOf(Math.max(...hit.weights));
    return chartStorage(this.controller.chart).faces[hit.chartFace * 3 + corner]!;
  }
  selectAt(x: number, y: number): void { this.controller.select(this.hit(x, y)?.location ?? null); }
  dispose(): void { if (!this.detached) { this.detached = true; this.unselect(); this.preparation?.abort(); this.view.detachQuantitative(this); } }
}
