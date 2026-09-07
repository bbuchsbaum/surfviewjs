import type { AtlasPoint, AtlasRaster } from './types';

interface Edge { a: number; b: number; forward: number; reverse: number }
interface Segment { from: AtlasPoint; to: AtlasPoint; control?: AtlasPoint }
interface Arc extends Edge { points: AtlasPoint[]; segments: Segment[] }
interface DirectedArc { arc: Arc; reversed: boolean }

function smooth(points: AtlasPoint[], displacement: number, resolution: number): AtlasPoint[] {
  if (!displacement || points.length < 4) return points;
  const last = points.length - 1;
  const closed = points[0]!.x === points[last]!.x && points[0]!.y === points[last]!.y;
  // A wider Gaussian removes the mesh-scale sawtooth, not just visibility pixels.
  // Reserve one quarter of the displacement budget for rounding the SVG corners.
  const sigma = Math.max(1, displacement * resolution * 1.5);
  const radius = Math.ceil(sigma * 3);
  const weights = Array.from({ length: radius + 1 }, (_, j) => Math.exp(-0.5 * (j / sigma) ** 2));
  const smoothed = points.map((p, i) => {
    if (!closed && (i === 0 || i === last)) return p; // Fixed shared junctions.
    let x = 0, y = 0, weight = 0;
    for (let j = -radius; j <= radius; j++) {
      const index = closed ? ((i + j) % last + last) % last : Math.max(0, Math.min(last, i + j));
      const w = weights[Math.abs(j)]!;
      x += points[index]!.x * w; y += points[index]!.y * w; weight += w;
    }
    const dx = x / weight - p.x, dy = y / weight - p.y;
    const fade = closed ? 1 : Math.min(1, i / sigma, (last - i) / sigma);
    const scale = fade * Math.min(1, displacement * 0.75 / Math.max(Math.hypot(dx, dy), 1e-12));
    return { x: p.x + dx * scale, y: p.y + dy * scale };
  });
  if (closed) smoothed[last] = smoothed[0]!;
  return smoothed;
}

function simplify(points: AtlasPoint[], tolerance: number): AtlasPoint[] {
  if (points.length <= 2) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = 1; keep[points.length - 1] = 1;
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length) {
    const [start, end] = stack.pop()!;
    const a = points[start]!, b = points[end]!;
    const dx = b.x - a.x, dy = b.y - a.y;
    const length = dx * dx + dy * dy;
    let farthest = -1, maximum = tolerance * tolerance;
    for (let i = start + 1; i < end; i++) {
      const p = points[i]!;
      const t = length ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / length)) : 0;
      const distance = (p.x - a.x - t * dx) ** 2 + (p.y - a.y - t * dy) ** 2;
      if (distance > maximum) { maximum = distance; farthest = i; }
    }
    if (farthest >= 0) {
      keep[farthest] = 1;
      stack.push([start, farthest], [farthest, end]);
    }
  }
  const reduced = points.filter((_, i) => keep[i]);
  // Do not collapse a tiny closed component to a point or line.
  return reduced.length < 4 && points[0]!.x === points[points.length - 1]!.x &&
    points[0]!.y === points[points.length - 1]!.y ? points : reduced;
}

function segments(points: AtlasPoint[], rounding: number): Segment[] {
  if (!rounding || points.length < 4) return points.slice(1).map((to, i) => ({ from: points[i]!, to }));
  const closed = points[0]!.x === points[points.length - 1]!.x && points[0]!.y === points[points.length - 1]!.y;
  const vertices = closed ? points.slice(0, -1) : points;
  const corners = vertices.map((p, i) => {
    if (!closed && (i === 0 || i === vertices.length - 1)) return { entry: p, exit: p };
    const prev = vertices[(i + vertices.length - 1) % vertices.length]!;
    const next = vertices[(i + 1) % vertices.length]!;
    const incoming = Math.hypot(prev.x - p.x, prev.y - p.y);
    const outgoing = Math.hypot(next.x - p.x, next.y - p.y);
    const trim = Math.min(rounding, incoming / 2, outgoing / 2);
    const towards = (q: AtlasPoint, length: number): AtlasPoint => length ?
      { x: p.x + (q.x - p.x) * trim / length, y: p.y + (q.y - p.y) * trim / length } : p;
    return { entry: towards(prev, incoming), exit: towards(next, outgoing) };
  });
  const result: Segment[] = [];
  let from = corners[0]!.exit;
  for (let j = 1; j < vertices.length + Number(closed); j++) {
    const i = j % vertices.length;
    const { entry, exit } = corners[i]!;
    result.push({ from, to: entry });
    if (entry !== exit) result.push({ from: entry, to: exit, control: vertices[i]! });
    from = exit;
  }
  return result;
}

function path(parts: Segment[], move = true): string {
  const point = (p: AtlasPoint): string => `${+p.x.toFixed(3)},${+p.y.toFixed(3)}`;
  return (move ? `M${point(parts[0]!.from)}` : '') + parts.map(s =>
    s.control ? `Q${point(s.control)} ${point(s.to)}` : `L${point(s.to)}`).join('');
}

/**
 * Trace the planar interface graph once. Adjacent fills reuse the same arcs in
 * opposite directions, including triple junctions, islands and medial-wall holes.
 * Simplification is bounded to 0.4 visibility pixels, preserving grid topology.
 */
export function atlasContours(raster: AtlasRaster, smoothing = 0, groups?: ReadonlyMap<number, string>): {
  paths: Map<number, string>; boundaryPath: string; silhouettePath: string; groupBoundaryPath: string
} {
  const { width: w, height: h, ids, resolution } = raster;
  const stride = w + 1;
  const edges: Edge[] = [];
  const adjacency = new Map<number, number[]>();
  function edge(a: number, b: number, forward: number, reverse: number): void {
    if (forward === reverse) return;
    if (edges.length >= 1_000_000) throw new RangeError('Atlas projection exceeds one million boundary segments; reduce resolution');
    const index = edges.length;
    edges.push({ a, b, forward, reverse });
    for (const v of [a, b]) {
      const list = adjacency.get(v);
      if (list) list.push(index); else adjacency.set(v, [index]);
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const id = ids[y * w + x]!;
      const p = y * stride + x;
      if (x === 0) edge(p, p + stride, 0, id);
      if (y === 0) edge(p, p + 1, id, 0);
      edge(p + 1, p + 1 + stride, id, x + 1 < w ? ids[y * w + x + 1]! : 0);
      edge(p + stride, p + stride + 1, y + 1 < h ? ids[(y + 1) * w + x]! : 0, id);
    }
  }
  const seen = new Uint8Array(edges.length);
  const arcs: Arc[] = [];
  const point = (v: number): AtlasPoint => ({ x: (v % stride) / resolution, y: Math.floor(v / stride) / resolution });
  const trace = (first: number, start: number): void => {
    if (seen[first]) return;
    const e = edges[first]!;
    const forward = start === e.a ? e.forward : e.reverse;
    const reverse = start === e.a ? e.reverse : e.forward;
    let current = start, index = first;
    const points = [point(start)];
    while (!seen[index]) {
      seen[index] = 1;
      const next = edges[index]!;
      current = current === next.a ? next.b : next.a;
      points.push(point(current));
      const choices = adjacency.get(current)!;
      if (choices.length !== 2 || current === start) break;
      index = choices[0] === index ? choices[1]! : choices[0]!;
    }
    // Keep tiny components legible even when the requested smoothing is large.
    const localSmoothing = Math.min(smoothing, (points.length - 1) / (16 * resolution));
    const reduced = simplify(smooth(points, localSmoothing, resolution), 0.4 / resolution);
    arcs.push({ a: start, b: current, forward, reverse, points: reduced,
      segments: segments(reduced, localSmoothing * 0.25) });
  };
  for (const [vertex, list] of adjacency) {
    if (list.length !== 2) for (const index of list) trace(index, vertex);
  }
  for (let i = 0; i < edges.length; i++) trace(i, edges[i]!.a);

  const byRegion = new Map<number, DirectedArc[]>();
  for (const arc of arcs) {
    for (const [id, reversed] of [[arc.forward, false], [arc.reverse, true]] as const) {
      if (!id) continue;
      if (!byRegion.has(id)) byRegion.set(id, []);
      byRegion.get(id)!.push({ arc, reversed });
    }
  }
  const paths = new Map<number, string>();
  const startOf = (d: DirectedArc): number => d.reversed ? d.arc.b : d.arc.a;
  const endOf = (d: DirectedArc): number => d.reversed ? d.arc.a : d.arc.b;
  const pointsOf = (d: DirectedArc): AtlasPoint[] => d.reversed ? [...d.arc.points].reverse() : d.arc.points;
  const segmentsOf = (d: DirectedArc): Segment[] => d.reversed ? [...d.arc.segments].reverse().map(s =>
    ({ from: s.to, to: s.from, ...(s.control ? { control: s.control } : {}) })) : d.arc.segments;
  for (const [id, regionArcs] of byRegion) {
    const outgoing = new Map<number, DirectedArc[]>();
    for (const directed of regionArcs) {
      const start = startOf(directed);
      if (!outgoing.has(start)) outgoing.set(start, []);
      outgoing.get(start)!.push(directed);
    }
    const used = new Set<DirectedArc>();
    let result = '';
    for (const first of regionArcs) {
      if (used.has(first)) continue;
      let ring = '';
      let current = first;
      for (;;) {
        used.add(current);
        ring += path(segmentsOf(current), !ring);
        const end = endOf(current);
        if (end === startOf(first)) break;
        const candidates = (outgoing.get(end) ?? []).filter(d => !used.has(d));
        if (!candidates.length) throw new Error(`Unclosed atlas contour for parcel ${id}`);
        const points = pointsOf(current);
        const a = points[points.length - 2]!, b = points[points.length - 1]!;
        const turn = (d: DirectedArc): number => {
          const c = pointsOf(d)[1]!;
          return (Math.atan2((b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x),
            (b.x - a.x) * (c.x - b.x) + (b.y - a.y) * (c.y - b.y)) + Math.PI * 2) % (Math.PI * 2);
        };
        candidates.sort((a, b) => turn(a) - turn(b));
        current = candidates[0]!;
      }
      result += ring + 'Z';
    }
    paths.set(id, result);
  }
  return {
    paths,
    boundaryPath: arcs.filter(a => a.forward && a.reverse).map(a => path(a.segments)).join(''),
    groupBoundaryPath: arcs.filter(a => a.forward && a.reverse && groups?.has(a.forward) &&
      groups.has(a.reverse) && groups.get(a.forward) !== groups.get(a.reverse)).map(a => path(a.segments)).join(''),
    silhouettePath: arcs.filter(a => !a.forward || !a.reverse).map(a => path(a.segments)).join('')
  };
}
