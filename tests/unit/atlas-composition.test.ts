// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { buildAtlasPlate } from '../../src/atlas/buildAtlasPlate';
import { AtlasPlateView, renderAtlasPlateSVG } from '../../src/atlas/AtlasPlateView';
import { atlasDisplayLabels, atlasViewportBounds, emptyAtlasLayout, parseAtlasPlateLayout } from '../../src/atlas/atlasLayout';
import { parseAtlasFigureSpec, renderAtlasFigureSVG } from '../../src/atlas/AtlasFigure';
import type { AtlasFigureSpec } from '../../src/atlas/AtlasFigure';
import type { AtlasPlateInput } from '../../src/atlas/types';

const source = (): AtlasPlateInput => ({
  // Two independent rectangles; the second is a thin vertical strip.
  vertices: [0, -1, -1, 0, 0.6, -1, 0, 0.6, 1, 0, -1, 1,
    0, 0.85, -1, 0, 1, -1, 0, 1, 1, 0, 0.85, 1],
  faces: [0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7], vertexLabels: [1, 1, 1, 1, 2, 2, 2, 2],
  hemisphere: 'left', parcelData: { schema_version: '1', atlas: { id: 'strips', name: 'Strip atlas' },
    parcels: [{ id: 1, label: 'Large', hemi: 'left' }, { id: 2, label: 'Thin', hemi: 'left' },
      { id: 3, label: 'Hidden', hemi: 'left' }] }
});
const options = { width: 240, height: 240, padding: 20, resolution: 2, maxLeaderLength: 0, fontSize: 14, detailScales: [2, 4, 8] };

describe('atlas inspection and figure composition', () => {
  it('reveals the thin parcel at magnification without changing geometry or labeling hidden parcels', () => {
    const plate = buildAtlasPlate(source(), options);
    const plain = buildAtlasPlate(source(), { ...options, detailScales: [] });
    expect(plate.regions).toEqual(plain.regions);
    expect(plate.labels).toEqual(plain.labels);
    expect(plate.labels.map(p => p.id)).toEqual([1]);
    expect(plate.detailLevels.at(-1)!.labels.map(p => p.id)).toEqual([1, 2]);
    // Analytic LH lateral projection: thin parcel is x=20..35, y=20..220.
    expect(plate.regions.find(p => p.id === 2)!.bounds).toEqual({ x: 20, y: 20, width: 15, height: 200 });
    for (const level of plate.detailLevels) for (const label of level.labels.filter(p => p.id === 2)) {
      expect(label.x - label.width / 2).toBeGreaterThan(20);
      expect(label.x + label.width / 2).toBeLessThan(35);
      expect(label.y - label.height / 2).toBeGreaterThan(20);
      expect(label.y + label.height / 2).toBeLessThan(220);
    }
    const viewport = { zoom: 8, center: { x: 28, y: 120 } };
    const labels = atlasDisplayLabels(plate, { viewport });
    expect(labels.map(p => p.id)).toContain(2);
    expect(labels.map(p => p.id)).not.toContain(3);
    const root = new DOMParser().parseFromString(renderAtlasPlateSVG(plate, {}, { viewport }), 'image/svg+xml');
    expect(Number(root.querySelector('.atlas-labels')!.getAttribute('font-size')) * 8).toBe(14);
    expect(() => buildAtlasPlate(source(), { ...options, detailScales: [NaN] })).toThrow();
    expect(() => buildAtlasPlate(source(), { ...options, detailScales: [1, 2] })).toThrow();
  });

  it('binds pins to atlas, projection and sampled geometry while allowing smoothing and recoloring', () => {
    const plate = buildAtlasPlate(source(), options);
    const layout = { ...emptyAtlasLayout(plate), labels: [{ id: 1, x: 140, y: 12 }] };
    expect(parseAtlasPlateLayout(plate, JSON.parse(JSON.stringify(layout)))).toEqual(layout);
    const smoother = buildAtlasPlate(source(), { ...options, contourSmoothing: 4 });
    expect(parseAtlasPlateLayout(smoother, layout)).toEqual(layout);
    const other = source(); other.parcelData.atlas.id = 'another-atlas';
    for (const wrong of [buildAtlasPlate(other, options), buildAtlasPlate(source(), { ...options, view: 'medial' }),
      buildAtlasPlate(source(), { ...options, padding: 30 })]) expect(() => parseAtlasPlateLayout(wrong, layout)).toThrow(/different/);
    expect(() => parseAtlasPlateLayout(plate, { ...layout, labels: [{ id: 3, x: 10, y: 10 }] })).toThrow(/visible label/);
    expect(() => parseAtlasPlateLayout(plate, { ...layout, labels: [{ id: 1, x: -1, y: 10 }] })).toThrow(/clipped/);
    expect(() => parseAtlasPlateLayout(plate, { ...layout, labels: [layout.labels[0], layout.labels[0]] })).toThrow(/Duplicate/);
  });

  it('reserves pins ahead of automatic labels, with independent anchors and no source mutation', () => {
    const plate = buildAtlasPlate(source(), options);
    const automatic = structuredClone(plate.labels);
    const p = plate.labels[0]!;
    const layout = { ...emptyAtlasLayout(plate), labels: [{ id: 2, x: p.x, y: p.y }] };
    const labels = atlasDisplayLabels(plate, { layout });
    expect(labels.map(p => p.id)).toEqual([2]); // auto label 1 yields to an explicit pin
    expect(labels[0]!.anchor.x).toBeGreaterThan(20);
    expect(labels[0]!.anchor.x).toBeLessThan(35);
    expect(labels[0]!.callout).toBe(true);
    expect(plate.labels).toEqual(automatic);
    const svg = new DOMParser().parseFromString(renderAtlasPlateSVG(plate, {}, { layout }), 'image/svg+xml');
    const metadata = JSON.parse(svg.querySelector('metadata')!.textContent!);
    expect(metadata.displayedLabelIds).toEqual([2]);
    expect(metadata.unlabeledParcelIds).toEqual([1]);
    expect(metadata.overviewUnlabeledParcelIds).toEqual([2]);
  });

  it('clamps zoom to the plate and preserves a pin across style, focus and rebuild changes', () => {
    const plate = buildAtlasPlate(source(), options);
    expect(atlasViewportBounds(plate, { zoom: 2, center: { x: -99, y: 999 } })).toEqual({ x: 0, y: 120, width: 120, height: 120 });
    expect(() => atlasViewportBounds(plate, { zoom: Infinity, center: { x: 0, y: 0 } })).toThrow();
    const host = document.createElement('div'); document.body.append(host);
    const view = new AtlasPlateView(host, plate);
    view.setLabelPosition(1, { x: 140, y: 12 });
    const pins = view.getLayout();
    view.getLayout().labels[0]!.x = 500; // defensive copy
    view.setColors(new Map([[1, '#203344']]));
    expect(view.focusParcel(2)).toBe(true);
    expect(view.focusParcel(3)).toBe(false);
    view.setZoom(2);
    expect(view.toSVG()).not.toEqual(view.toSVG({ overview: true }));
    view.setPlate(buildAtlasPlate(source(), { ...options, contourSmoothing: 4 }));
    expect(view.getLayout()).toEqual(pins);
    const snapshot = view.toSVG();
    expect(() => view.setLayout({ ...pins, version: 2 } as never)).toThrow();
    expect(view.toSVG()).toBe(snapshot);
    view.resetLabels(); expect(view.getLayout().labels).toEqual([]);
    view.dispose(); view.dispose(); host.remove();
    expect(() => view.setZoom(2)).toThrow(/disposed/);
  });

  it('supports keyboard label editing and unpinning with one change event', () => {
    const plate = buildAtlasPlate(source(), options), onLayoutChange = vi.fn();
    const host = document.createElement('div'); document.body.append(host);
    const view = new AtlasPlateView(host, plate, { editableLabels: true, onLayoutChange });
    const text = () => host.querySelector<SVGTextElement>('.atlas-labels text')!;
    const x = Number(text().getAttribute('x')); text().focus();
    text().dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', shiftKey: true, bubbles: true }));
    expect(view.getLayout().labels[0]!.x).toBe(x + 10);
    expect(document.activeElement).toBe(text()); expect(onLayoutChange).toHaveBeenCalledTimes(1);
    text().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(view.getLayout().labels).toEqual([]); expect(onLayoutChange).toHaveBeenCalledTimes(2);
    view.dispose(); host.remove();
  });

  it('round-trips composition, escapes text, and exports overview panels with provenance and current fills', () => {
    const input = source(); input.provenance = { source: 'fixture', checksum: 'example-checksum' };
    const plate = buildAtlasPlate(input, options), medial = buildAtlasPlate(input, { ...options, view: 'medial' });
    const spec: AtlasFigureSpec = { version: 1, title: 'A <figure> & "labels"', subtitle: 'Example', columns: 2,
      panels: [{ key: 'left-lateral', title: 'Lateral', layout: emptyAtlasLayout(plate) },
        { key: 'left-medial', title: 'Medial', layout: emptyAtlasLayout(medial) }],
      legend: [{ label: 'Network A', color: '#123' }] };
    const sources = new Map([['left-lateral', { plate, style: { colors: new Map([[1, '#314159']]) } }],
      ['left-medial', { plate: medial }]]);
    expect(parseAtlasFigureSpec(JSON.parse(JSON.stringify(spec)), sources)).toEqual(spec);
    const document = new DOMParser().parseFromString(renderAtlasFigureSVG(spec, sources), 'image/svg+xml');
    expect(document.querySelector('parsererror')).toBeNull();
    expect(document.documentElement.getAttribute('width')).toBe('584'); // 2*240 + 2*36 + 32
    expect(document.querySelectorAll('svg svg')).toHaveLength(2);
    expect(document.querySelector('title')!.textContent).toBe(spec.title);
    expect(document.querySelector('.atlas-regions path')!.getAttribute('fill')).toBe('#314159');
    expect(document.documentElement.textContent).toContain('example-checksum');
    expect(() => parseAtlasFigureSpec({ ...spec, panels: [spec.panels[0], spec.panels[0]] }, sources)).toThrow(/Duplicate/);
    expect(() => parseAtlasFigureSpec({ ...spec, version: 99 }, sources)).toThrow(/version/);
    expect(() => renderAtlasFigureSVG({ ...spec, legend: [{ label: 'x', color: 'red"/>' }] }, sources)).toThrow(/colors/);
  });
});
