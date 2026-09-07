// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { buildAtlasPlate } from '../../src/atlas/buildAtlasPlate';
import { AtlasPlateView, renderAtlasPlateSVG } from '../../src/atlas/AtlasPlateView';
import { atlasContours } from '../../src/atlas/atlasContours';
import { projectAtlas } from '../../src/atlas/projectAtlas';
import { layoutAtlasLabels } from '../../src/atlas/layoutAtlasLabels';
import { packAtlasCallouts } from '../../src/atlas/packAtlasCallouts';
import type { AtlasPlateInput, AtlasPoint } from '../../src/atlas/types';

function square(): AtlasPlateInput {
  return {
    vertices: [0, -1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1], faces: [0, 1, 2, 0, 2, 3],
    vertexLabels: [1, 1, 1, 1], hemisphere: 'left',
    parcelData: { schema_version: '1', atlas: { id: 'test', name: 'Test atlas' },
      parcels: [{ id: 1, label: 'One', hemi: 'left' }, { id: 2, label: 'Two', hemi: 'left' }] }
  };
}
const small = { width: 240, height: 220, padding: 40, resolution: 1, fontSize: 12 };

// Independent SVG decoder and quadratic evaluation, then even-odd ray crossing.
function rings(path: string): AtlasPoint[][] {
  const result: AtlasPoint[][] = [];
  let current: AtlasPoint[] = [];
  for (const match of path.matchAll(/([MLQZ])([^MLQZ]*)/g)) {
    const values = (match[2]!.match(/-?[\d.]+/g) ?? []).map(Number);
    const end = { x: values[values.length - 2]!, y: values[values.length - 1]! };
    if (match[1] === 'M') { current = [end]; result.push(current); }
    else if (match[1] === 'L') {
      const a = current[current.length - 1]!;
      const count = Math.max(1, Math.ceil(Math.hypot(end.x - a.x, end.y - a.y)));
      for (let j = 1; j <= count; j++) current.push({ x: a.x + (end.x - a.x) * j / count,
        y: a.y + (end.y - a.y) * j / count });
    }
    else if (match[1] === 'Q') {
      const a = current[current.length - 1]!;
      for (let j = 1; j <= 32; j++) {
        const t = j / 32, s = 1 - t;
        current.push({ x: s * s * a.x + 2 * s * t * values[0]! + t * t * end.x,
          y: s * s * a.y + 2 * s * t * values[1]! + t * t * end.y });
      }
    }
  }
  return result;
}
function contains(path: string, x: number, y: number): boolean {
  let inside = false;
  for (const ring of rings(path)) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const a = ring[i]!, b = ring[j]!;
      if ((a.y > y) !== (b.y > y) && x < (b.x - a.x) * (y - a.y) / (b.y - a.y) + a.x) inside = !inside;
    }
  }
  return inside;
}

describe('atlas geometry contracts', () => {
  it('rejects malformed geometry before allocating the visibility buffer', () => {
    for (const vertices of [[], [0, 1], [0, NaN, 1], [0, Infinity, 1]]) {
      expect(() => buildAtlasPlate({ ...square(), vertices }, small)).toThrow();
    }
    for (const faces of [[], [0, 1], [0, 1, 4], [0, -1, 2], [0, 1.5, 2]]) {
      expect(() => buildAtlasPlate({ ...square(), faces }, small)).toThrow();
    }
    expect(() => buildAtlasPlate({ ...square(), vertices: { length: 30_000_003 } }, small)).toThrow(/vertex count exceeds/);
    expect(() => buildAtlasPlate({ ...square(), faces: { length: 60_000_003 } }, small)).toThrow(/face count exceeds/);
  });

  it('emphasizes only explicit group interfaces without changing parcel geometry', () => {
    const raster = { width: 4, height: 2, resolution: 1, ids: new Uint32Array([1, 1, 2, 3, 1, 1, 2, 3]) };
    const plain = atlasContours(raster);
    const grouped = atlasContours(raster, 0, new Map([[1, 'A'], [2, 'A'], [3, 'B']]));
    expect(grouped.paths).toEqual(plain.paths);
    expect(grouped.boundaryPath).toEqual(plain.boundaryPath);
    const edge = rings(grouped.groupBoundaryPath).flat();
    expect(edge.length).toBeGreaterThan(1);
    expect(edge.every(p => p.x === 3)).toBe(true); // only the 2/3 interface, not 1/2 or exterior
    expect(Math.min(...edge.map(p => p.y))).toBe(0);
    expect(Math.max(...edge.map(p => p.y))).toBe(2);
    expect(atlasContours(raster, 0, new Map([[1, 'A']])).groupBoundaryPath).toBe('');
    expect(() => buildAtlasPlate(square(), { ...small, parcelGroups: new Map([[9, 'A']]) })).toThrow(/Unknown parcel/);
  });
  it('depth-tests both parcel and zero-labeled medial-wall occluders, regardless of face order', () => {
    const input = square();
    input.vertices = [...input.vertices as number[], ...(input.vertices as number[]).map((v, i) => i % 3 === 0 ? 1 : v)];
    input.faces = [0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7];
    input.vertexLabels = [1, 1, 1, 1, 2, 2, 2, 2];
    const medial = buildAtlasPlate(input, { ...small, view: 'medial' });
    expect(medial.regions.map(r => r.id)).toEqual([2]);
    expect(medial.hiddenParcelIds).toEqual([1]);
    const frontFirst = { ...input, faces: [4, 6, 7, 4, 5, 6, 0, 2, 3, 0, 1, 2] };
    expect(buildAtlasPlate(frontFirst, { ...small, view: 'medial' })).toEqual(medial);
    expect(buildAtlasPlate(input, { ...small, view: 'lateral' }).regions.map(r => r.id)).toEqual([1]);
    input.vertexLabels = [1, 1, 1, 1, 0, 0, 0, 0];
    expect(buildAtlasPlate(input, { ...small, view: 'medial' }).regions).toEqual([]);
  });

  it('partitions a three-label triangle into equal categorical areas and preserves IDs', () => {
    const input = square();
    input.vertices = [0, -1, -1, 0, 1, -1, 0, 0, 1];
    input.faces = [0, 1, 2]; input.vertexLabels = [1, 2, 70000];
    input.parcelData.parcels.push({ id: 70000, label: 'Three', hemi: 'left' });
    const raster = projectAtlas(input, 'medial', 400, 400, 20, 1);
    const counts = [1, 2, 70000].map(id => raster.ids.reduce((n, value) => n + Number(value === id), 0));
    // Analytic triangle area is 360*360/2; categorical corner cells each own 1/3.
    for (const count of counts) expect(Math.abs(count - 21600)).toBeLessThan(360);
    const reversed = projectAtlas({ ...input, faces: [2, 1, 0] }, 'medial', 400, 400, 20, 1);
    expect(reversed.ids.every((id, i) => id === raster.ids[i])).toBe(true);
  });

  it('uses anatomical directions for both hemispheres', () => {
    const input = square(); input.vertexLabels = [1, 2, 2, 1];
    const left = projectAtlas(input, 'lateral', 200, 200, 20, 1);
    const right = projectAtlas({ ...input, hemisphere: 'right' }, 'lateral', 200, 200, 20, 1);
    expect(left.ids[100 * 200 + 30]).toBe(2); // anterior is left in LH lateral
    expect(right.ids[100 * 200 + 30]).toBe(1);
    expect(left.ids[100 * 200 + 169]).toBe(1);
    expect(right.ids[100 * 200 + 169]).toBe(2);
  });

  it('preserves holes, disconnected islands, and checkerboard junctions in SVG fills', () => {
    const masks = [
      [1, 1, 1, 1, 1, 1, 0, 0, 0, 1, 1, 0, 2, 0, 1, 1, 0, 0, 0, 1, 1, 1, 1, 1, 1],
      Array.from({ length: 25 }, (_, i) => (i + Math.floor(i / 5)) % 2 + 1),
      [1, 0, 2, 0, 1, 0, 2, 1, 2, 0, 2, 1, 0, 1, 2, 0, 2, 1, 2, 0, 1, 0, 2, 0, 1]
    ];
    let seed = 53;
    for (let trial = 0; trial < 20; trial++) {
      masks.push(Array.from({ length: 25 }, () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed % 4; }));
    }
    for (const mask of masks) {
      const { paths } = atlasContours({ width: 5, height: 5, resolution: 1, ids: new Uint32Array(mask) });
      for (let y = 0; y < 5; y++) for (let x = 0; x < 5; x++) {
        for (const [id, path] of paths) expect(contains(path, x + 0.5, y + 0.5)).toBe(mask[y * 5 + x] === id);
      }
    }
  });

  it('rejects mismatched domains and excessive allocations before building', () => {
    expect(() => buildAtlasPlate({ ...square(), vertexLabels: [1] }, small)).toThrow(/vertex count/);
    expect(() => buildAtlasPlate({ ...square(), vertexLabels: [1, 1, -1, 1] }, small)).toThrow();
    expect(() => buildAtlasPlate({ ...square(), vertexLabels: [1, 1, 1.5, 1] }, small)).toThrow();
    expect(() => buildAtlasPlate({ ...square(), vertexLabels: [1, 1, 9, 1] }, small)).toThrow(/metadata/);
    expect(() => buildAtlasPlate(square(), { width: 4096, height: 4096, resolution: 4 })).toThrow(/million/);
    expect(() => buildAtlasPlate(square(), { ...small, fontSize: NaN })).toThrow();
    const mismatch = square(); mismatch.parcelData.parcels[0]!.hemi = 'right';
    expect(() => buildAtlasPlate(mismatch, small)).toThrow(/hemisphere/);
  });

  it('keeps smoothed shared interfaces consistent away from the recorded displacement band', () => {
    const ids = new Uint32Array(80 * 70);
    for (let y = 10; y < 60; y++) for (let x = 10; x < 70; x++) {
      ids[y * 80 + x] = x < 40 + (y % 3) ? 1 : 2;
    }
    const raster = { ids, width: 80, height: 70, resolution: 1 };
    const smoothed = atlasContours(raster, 1.4);
    for (let y = 14; y < 56; y++) for (const x of [15, 30, 50, 65]) {
      const expected = ids[y * 80 + x];
      for (const [id, path] of smoothed.paths) expect(contains(path, x + 0.5, y + 0.5)).toBe(id === expected);
    }
    expect(smoothed.boundaryPath).not.toEqual(atlasContours(raster).boundaryPath);
    expect(buildAtlasPlate(square(), { ...small, contourSmoothing: 1.4 }).contourSmoothing).toBe(1.4);
  });

  it('removes high-frequency boundary stair steps while keeping fills complementary and IDs unchanged', () => {
    const ids = new Uint32Array(100 * 150);
    for (let y = 5; y < 145; y++) for (let x = 5; x < 95; x++) ids[y * 100 + x] = x < 49 + y % 4 ? 1 : 2;
    const before = ids.slice();
    const raster = { width: 100, height: 150, resolution: 1, ids };
    const raw = atlasContours(raster);
    const smoothed = atlasContours(raster, 4);
    const roughness = (d: string): number => {
      const p = rings(d).flat().filter(p => p.y > 35 && p.y < 115);
      return Math.sqrt(p.reduce((n, p) => n + (p.x - 50.5) ** 2, 0) / p.length);
    };
    expect(smoothed.boundaryPath).toContain('Q');
    expect(roughness(smoothed.boundaryPath)).toBeLessThan(roughness(raw.boundaryPath) * 0.25);
    // Dense samples straddling the boundary must belong to exactly one region.
    for (let y = 20.137; y < 130; y += 1.7) for (let x = 45.137; x < 55; x += 0.31) {
      expect([...smoothed.paths.values()].filter(d => contains(d, x, y))).toHaveLength(1);
    }
    expect([...smoothed.paths.keys()]).toEqual([...raw.paths.keys()]);
    expect(ids).toEqual(before);
    const displacement = 4 + 0.4; // documented smoothing + simplification allowance
    const sourceRings = rings(raw.boundaryPath);
    for (const p of rings(smoothed.boundaryPath).flat()) {
      // Independent nearest source segment distance for every sampled curve point.
      let nearest = Infinity;
      for (const ring of sourceRings) for (let i = 1; i < ring.length; i++) {
        const a = ring[i - 1]!, b = ring[i]!;
        const dx = b.x - a.x, dy = b.y - a.y;
        const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy)));
        nearest = Math.min(nearest, Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy));
      }
      expect(nearest).toBeLessThanOrEqual(displacement + 0.002); // SVG rounding
    }
    expect(() => buildAtlasPlate(square(), { ...small, contourSmoothing: 8.1 })).toThrow();
  });
});

describe('atlas text and presentation contracts', () => {
  it('balances callout displacement symmetrically and respects spacing and margin capacity', () => {
    // Analytic two-label optimum: midpoint stays 111, separation is 20+16.
    expect(packAtlasCallouts([110, 112], [20, 20], 16, 0, 300)).toEqual([93, 129]);
    const anchors = [7, 80, 82, 86, 290], sizes = [20, 15, 40, 25, 12];
    const packed = packAtlasCallouts(anchors, sizes, 16, 10, 290)!;
    const mirrored = packAtlasCallouts([...anchors].reverse().map(x => 300 - x), [...sizes].reverse(), 16, 10, 290)!;
    packed.forEach((x, i) => {
      expect(x).toBeCloseTo(300 - mirrored[packed.length - 1 - i]!, 10);
      expect(x - sizes[i]! / 2).toBeGreaterThanOrEqual(10);
      expect(x + sizes[i]! / 2).toBeLessThanOrEqual(290);
      if (i) expect(x - packed[i - 1]! - (sizes[i]! + sizes[i - 1]!) / 2).toBeGreaterThanOrEqual(16 - 1e-10);
    });
    expect(packAtlasCallouts([20, 30], [50, 50], 16, 0, 100)).toBeNull();
  });

  it('changes boundary appearance independently of parcel colors and labels, with atomic validation', () => {
    const input = square(); input.vertexLabels = [1, 1, 2, 2];
    const plate = buildAtlasPlate(input, { ...small, parcelGroups: new Map([[1, 'Motor'], [2, 'Visual']]) });
    const host = document.createElement('div');
    const view = new AtlasPlateView(host, plate, { colors: new Map([[1, '#acf'], [2, '#acf']]) });
    expect(host.querySelector('.atlas-boundary-halo')).toBeNull();
    expect(host.querySelector('.atlas-group-boundaries')).not.toBeNull(); // equal colors do not erase grouping
    const paths = [...host.querySelectorAll('.atlas-regions path')].map(p => p.outerHTML);
    const labels = host.querySelector('.atlas-labels')!.outerHTML;
    view.setStyle({ boundaryWidth: 0.5, boundaryColor: '#333', groupBoundaryWidth: 0, outlineWidth: 2 });
    expect(host.querySelector('.atlas-group-boundaries')).toBeNull();
    expect(host.querySelector('.atlas-boundaries')!.getAttribute('stroke-width')).toBe('0.5');
    expect([...host.querySelectorAll('.atlas-regions path')].map(p => p.outerHTML)).toEqual(paths);
    expect(host.querySelector('.atlas-labels')!.outerHTML).toBe(labels);
    const before = view.toSVG();
    expect(() => view.setStyle({ boundaryOpacity: 2 })).toThrow();
    expect(() => view.setStyle({ boundaryColor: 'url(evil)' })).toThrow();
    expect(view.toSVG()).toBe(before);
    const metadata = JSON.parse(host.querySelector('metadata')!.textContent!);
    expect(metadata.parcelGroups).toEqual({ 1: 'Motor', 2: 'Visual' });
    view.dispose();
  });
  it('supports compact display labels without replacing canonical parcel names or IDs', () => {
    const input = square();
    input.parcelData.parcels[0]!.label = '7Networks_LH_Vis_1';
    const plate = buildAtlasPlate(input, { ...small, labelText: p => String(p.id) });
    expect(plate.labels[0]!.text).toBe('1');
    expect(plate.regions[0]!.label).toBe('7Networks_LH_Vis_1');
    const svg = renderAtlasPlateSVG(plate);
    expect(svg).toContain('<title>7Networks_LH_Vis_1</title>');
    expect(svg).toContain('>1</text>');
    expect(svg).toContain('aria-label="7Networks_LH_Vis_1"');
    expect(() => buildAtlasPlate(input, { ...small, labelText: () => '' })).toThrow(/non-empty/);
  });
  it('puts interior text inside the visible region, with non-overlapping margin callouts for narrow regions', () => {
    const ids = new Uint32Array(300 * 240);
    for (let y = 55; y < 185; y++) for (let x = 55; x < 245; x++) ids[y * 300 + x] = x < 180 ? 1 : x < 183 ? 2 : 3;
    const labels = layoutAtlasLabels({ ids, width: 300, height: 240, resolution: 1 },
      [{ id: 1, text: 'Wide', area: 15000 }, { id: 2, text: 'Narrow', area: 390 }, { id: 3, text: 'Other', area: 8000 }],
      { width: 300, height: 240, padding: 50, fontSize: 12, minLabelArea: 0, measureText: text => text.length * 7 });
    expect(labels).toHaveLength(3);
    expect(labels.find(label => label.id === 2)!.callout).toBe(true);
    for (const a of labels) {
      expect(ids[Math.floor(a.anchor.y) * 300 + Math.floor(a.anchor.x)]).toBe(a.id);
      expect(a.x - a.width / 2).toBeGreaterThanOrEqual(0);
      expect(a.y - a.height / 2).toBeGreaterThanOrEqual(0);
      if (!a.callout) for (let y = Math.floor(a.y - a.height / 2); y <= a.y + a.height / 2; y++) {
        for (let x = Math.floor(a.x - a.width / 2); x <= a.x + a.width / 2; x++) expect(ids[y * 300 + x]).toBe(a.id);
      }
      for (const b of labels) if (a !== b) expect(Math.abs(a.x - b.x) >= (a.width + b.width) / 2 ||
        Math.abs(a.y - b.y) >= (a.height + b.height) / 2).toBe(true);
    }
  });

  it('reports unplaced visible regions and supports saved positions without moving the parcel anchor', () => {
    const original = buildAtlasPlate(square(), small);
    const positioned = buildAtlasPlate(square(), { ...small, labelPositions: new Map([[1, { x: 120, y: 15 }]]) });
    expect(positioned.labels[0]!.anchor).toEqual(original.labels[0]!.anchor);
    expect(positioned.labels[0]!.callout).toBe(true);
    const excluded = buildAtlasPlate(square(), { ...small, minLabelArea: 1e6 });
    expect(excluded.labels).toHaveLength(0);
    expect(excluded.unlabeledParcelIds).toEqual([1]);
    expect(excluded.hiddenParcelIds).toEqual([2]);
  });

  it('escapes atlas text and exports vector paths/text without external content', () => {
    const input = square(); input.parcelData.parcels[0]!.label = 'A<&"';
    input.provenance = { source: 'https://example.org/atlas', citation: 'Example <atlas>', checksum: 'sha256:test' };
    const plate = buildAtlasPlate(input, small);
    const svg = renderAtlasPlateSVG(plate);
    const xml = new DOMParser().parseFromString(svg, 'image/svg+xml');
    expect(xml.querySelector('parsererror')).toBeNull();
    expect(xml.querySelector('text')!.textContent).toBe('A<&"');
    expect(JSON.parse(xml.querySelector('metadata')!.textContent!).provenance).toEqual(input.provenance);
    expect(xml.querySelectorAll('image,script,foreignObject')).toHaveLength(0);
    expect(() => renderAtlasPlateSVG(plate, { colors: new Map([[1, 'url(https://example.com)']]) })).toThrow();
  });

  it('recolors without changing layout, synchronizes selection once, and releases handlers on disposal', () => {
    const host = document.createElement('div'); document.body.append(host);
    const plate = buildAtlasPlate(square(), small);
    const onClick = vi.fn();
    const view = new AtlasPlateView(host, plate, { onParcelClick: onClick });
    const text = host.querySelector('text')!;
    const before = [text.getAttribute('x'), text.getAttribute('y'), text.textContent];
    view.setColors(new Map([[1, '#101010']]));
    const after = host.querySelector('text')!;
    expect([after.getAttribute('x'), after.getAttribute('y'), after.textContent]).toEqual(before);
    expect(after.getAttribute('fill')).toBe('#ffffff');
    const beforeInvalidColor = view.toSVG();
    expect(() => view.setColors(new Map([[1, 'bad-color']]))).toThrow();
    expect(view.toSVG()).toBe(beforeInvalidColor);
    after.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(onClick).toHaveBeenCalledExactlyOnceWith(1);
    view.setSelection(1); expect(onClick).toHaveBeenCalledTimes(1);
    expect(host.querySelector('[role="button"]')!.getAttribute('aria-pressed')).toBe('true');
    view.setLabelsVisible(false); expect(host.querySelector('text')).toBeNull();
    view.setLabelsVisible(true); expect(host.querySelector('text')).not.toBeNull();
    const detached = host.querySelector('text')!;
    view.dispose(); view.dispose();
    detached.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(onClick).toHaveBeenCalledTimes(1); expect(host.children).toHaveLength(0);
    expect(() => view.toSVG()).toThrow(/disposed/); host.remove();
  });

  it('preserves keyboard focus in the originating plate when linked selection updates its sibling', () => {
    const host = document.createElement('div'); document.body.append(host);
    const plate = buildAtlasPlate(square(), small);
    const first = new AtlasPlateView(host, plate, { onParcelClick: id => second.setSelection(id) });
    const second = new AtlasPlateView(host, plate);
    const region = first.element.querySelector<SVGGElement>('[role="button"]')!;
    region.focus();
    region.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(first.element.contains(document.activeElement)).toBe(true);
    expect(second.element.querySelector('[role="button"]')!.getAttribute('aria-pressed')).toBe('true');
    const replacement = { ...plate, labels: [] };
    first.setPlate(replacement);
    expect(first.element.querySelector('text')).toBeNull();
    expect(first.element.querySelector('[role="button"]')!.getAttribute('aria-pressed')).toBe('true');
    first.dispose(); second.dispose(); host.remove();
  });
});
