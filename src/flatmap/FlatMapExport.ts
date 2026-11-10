import { checkBudget, GeometryError } from '../geometry/GeometryError';
import { FlatMapController, type FlatMapControllerOptions } from './FlatMapController';
import { CanvasFlatMapRenderer } from './FlatMapRenderer';
import { normalizeFlatMapPresentation, type FlatMapPresentation } from './FlatMapPresentation';

export interface FlatMapExportOptions {
  width: number;
  height?: number;
  label: string;
  /** Caller-supplied provenance is preserved separately from derived method metadata. */
  provenance?: Record<string, unknown>;
  budgetBytes?: number;
  execution?: FlatMapControllerOptions;
  signal?: AbortSignal;
}

/** Exports an independent, unlit quantitative snapshot; never cancels an interactive render. */
export async function exportFlatMap(controller: FlatMapController, presentation: FlatMapPresentation, options: FlatMapExportOptions): Promise<{ png: Blob; metadata: Blob }> {
  const source = controller.snapshot(), p = normalizeFlatMapPresentation(presentation), bounds = source.chart.bounds;
  const label = options.label, provenance = structuredClone(options.provenance ?? {});
  const height = options.height ?? Math.max(1, Math.round(options.width * (bounds[3] - bounds[1]) / (bounds[2] - bounds[0])));
  checkBudget(options.width * height * 40 + options.width * 80 * 4, options.budgetBytes ?? 256 * 1024 * 1024);
  const snapshot = new FlatMapController(source.chart, options.execution), renderer = new CanvasFlatMapRenderer(p);
  try {
    snapshot.setSource(source.sampler, source.frame, source.policy);
    const grid = { width: options.width, height, bounds }; renderer.setGrid(grid);
    await snapshot.render(grid, (tile, values) => renderer.updateTile(tile, values), options.signal);
    const canvas = document.createElement('canvas'); canvas.width = options.width; canvas.height = height + 80;
    const context = canvas.getContext('2d'); if (!context) throw new GeometryError('invalid-domain', 'Canvas unavailable');
    context.fillStyle = '#0b1118'; context.fillRect(0, 0, canvas.width, canvas.height); context.drawImage(renderer.canvas, 0, 0);
    context.font = '14px sans-serif'; context.fillStyle = '#edf2f5'; context.fillText(label, 12, height + 20, canvas.width - 24);
    const colors = p.colorMap.getColors(), range = p.colorMap.getRange(), barWidth = Math.max(1, canvas.width - 120);
    for (let x = 0; x < barWidth; x++) {
      const c = colors[Math.floor(x / barWidth * (colors.length - 1))]!;
      context.fillStyle = `rgb(${c.slice(0, 3).map(v => Math.round(v * 255)).join(',')})`; context.fillRect(60 + x, height + 34, 1, 12);
    }
    context.fillStyle = '#edf2f5'; context.fillText(String(range[0]), 12, height + 45); context.fillText(String(range[1]), canvas.width - 50, height + 45);
    context.font = '11px sans-serif'; context.fillText('Unlit scalar map · hatched: incomplete support · relief disabled', 12, height + 66, canvas.width - 24);
    const description = source.sampler.describe();
    const metadata = { schema: 'surfview.quantitative-flatmap.v1', chart: await source.chart.fingerprint(), frame: await source.frame.fingerprint(), grid,
      method: description.kind === 'volume-scalar' ? 'midpoint-depth-sample-mean' : 'barycentric-vertex-scalar',
      source: description.kind === 'volume-scalar' ? { kind: description.kind, frame: description.frame, dims: description.dims,
        white: await description.white.fingerprint(), pial: await description.pial.fingerprint(),
        voxelToWorld: Array.from(description.voxelToWorld), depth: description.depth, interpolation: description.interpolation ?? 'linear' } : { kind: description.kind },
      missing: { missing: source.policy.missing ?? 'strict', minCoverage: source.policy.minCoverage ?? 1 },
      presentation: { range, threshold: p.colorMap.getThreshold(), colors, opacity: p.opacity, coverage: p.showCoverage, underlay: p.underlay, relief: false },
      label, provenance };
    const png = await new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('PNG encoding failed')), 'image/png'));
    return { png, metadata: new Blob([JSON.stringify(metadata, null, 2)], { type: 'application/json' }) };
  } finally { snapshot.dispose(); renderer.dispose(); }
}
