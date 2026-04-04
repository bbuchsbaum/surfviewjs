import { describe, expect, it } from 'vitest';
import { SurfaceGeometry } from '../../src/classes';
import { LabelLayer } from '../../src/layers';
import { ParcelConnectivityLayer } from '../../src/layers/ParcelConnectivityLayer';
import { ParcelValueLayer } from '../../src/layers/ParcelValueLayer';
import { OutlineLayer } from '../../src/OutlineLayer';
import { ParcelSurface } from '../../src/surfaces/ParcelSurface';
import type { ParcelData } from '../../src/parcellation';

if (typeof globalThis.requestAnimationFrame === 'undefined') {
  (globalThis as any).requestAnimationFrame = (cb: () => void) => setTimeout(cb, 0);
  (globalThis as any).cancelAnimationFrame = (id: number) => clearTimeout(id);
}

function makeGeometry(): SurfaceGeometry {
  return new SurfaceGeometry(
    new Float32Array([
      0, 0, 0,
      1, 0, 0,
      0, 1, 0
    ]),
    new Uint32Array([0, 1, 2]),
    'left'
  );
}

function makeParcelData(): ParcelData {
  return {
    schema_version: '1.0.0',
    atlas: {
      id: 'toy-atlas',
      name: 'Toy Atlas',
      n_parcels: 3,
      representation: 'surface',
      confidence: 'high'
    },
    parcels: [
      { id: 1, label: 'A', hemi: 'left', value: 1, network: 'motor' },
      { id: 2, label: 'B', hemi: 'left', value: 2, network: 'visual' },
      { id: 3, label: 'C', hemi: 'left', value: 3, network: 'motor' }
    ]
  };
}

describe('ParcelSurface', () => {
  it('exposes parcel-native lookup and pick metadata', () => {
    const surface = new ParcelSurface(makeGeometry(), {
      parcelData: makeParcelData(),
      vertexLabels: [1, 2, 3]
    });

    expect(surface.getParcelIdForVertex(1)).toBe(2);
    expect(surface.getParcelRecord(3)?.label).toBe('C');
    expect(surface.getParcelValue(1)).toBe(1);
    expect(surface.mapParcelValues('value')[2]).toBe(3);

    expect(surface.getPickMetadata(0)).toEqual(
      expect.objectContaining({
        parcelId: 1,
        parcelLabel: 'A',
        atlasId: 'toy-atlas'
      })
    );
    expect(surface.getRepresentativeVertexIndex(2)).toBe(1);
  });

  it('adds parcel value layers from the canonical parcellation', () => {
    const surface = new ParcelSurface(makeGeometry(), {
      parcelData: makeParcelData(),
      vertexLabels: [1, 2, 3]
    });

    const layer = surface.addParcelValueLayer('values', 'value', 'viridis', {
      range: [0, 3]
    });

    expect(layer).toBeInstanceOf(ParcelValueLayer);
    expect(layer.getData()).toEqual(new Float32Array([1, 2, 3]));
  });

  it('builds direct parcel color layers and keeps them synced with parcel metadata', () => {
    const surface = new ParcelSurface(makeGeometry(), {
      parcelData: makeParcelData(),
      vertexLabels: [1, 2, 3]
    });

    const layer = surface.addParcelColorLayer(
      'parcel-colors',
      parcel => parcel.network === 'motor' ? 0xff0000 : 0x0000ff
    );

    expect(layer).toBeInstanceOf(LabelLayer);
    let rgba = layer.getRGBAData(3);
    expect(Array.from(rgba.slice(0, 4))).toEqual([1, 0, 0, 1]);
    expect(Array.from(rgba.slice(4, 8))).toEqual([0, 0, 1, 1]);

    const next = makeParcelData();
    next.parcels[1].network = 'motor';
    surface.setParcelData(next);

    rgba = layer.getRGBAData(3);
    expect(Array.from(rgba.slice(4, 8))).toEqual([1, 0, 0, 1]);
  });

  it('resyncs managed parcel layers when the parcellation changes', () => {
    const surface = new ParcelSurface(makeGeometry(), {
      parcelData: makeParcelData(),
      vertexLabels: [1, 2, 3]
    });

    const valueLayer = surface.addParcelValueLayer('values', 'value', 'viridis', {
      range: [0, 3]
    });
    const colorLayer = surface.addParcelColorLayer(
      'parcel-colors',
      parcel => parcel.network === 'motor' ? 0xff0000 : 0x0000ff
    );

    const next = makeParcelData();
    next.parcels[0].value = 42;
    surface.setParcellation(next, [3, 1, 2]);

    expect(valueLayer.getData()).toEqual(new Float32Array([3, 42, 2]));
    const rgba = colorLayer.getRGBAData(3);
    expect(Array.from(rgba.slice(0, 4))).toEqual([1, 0, 0, 1]);
    expect(Array.from(rgba.slice(4, 8))).toEqual([1, 0, 0, 1]);
    expect(surface.getParcelIdForVertex(0)).toBe(3);
  });

  it('adds simple parcel outline edges and keeps labels synced', () => {
    const surface = new ParcelSurface(makeGeometry(), {
      parcelData: makeParcelData(),
      vertexLabels: [1, 2, 3]
    });

    const outline = surface.addParcelOutlineLayer('parcel-outline', {
      color: 0x000000,
      width: 2
    });

    expect(outline).toBeInstanceOf(OutlineLayer);
    expect(Array.from(outline.roiLabels)).toEqual([1, 2, 3]);

    surface.setVertexLabels([3, 3, 1]);
    expect(Array.from(outline.roiLabels)).toEqual([3, 3, 1]);
  });

  it('adds parcel connectivity overlays and keeps vertex mapping synced', () => {
    const surface = new ParcelSurface(makeGeometry(), {
      parcelData: makeParcelData(),
      vertexLabels: [1, 2, 3]
    });

    const layer = surface.addParcelConnectivityLayer(
      'conn',
      [
        [1.0, 0.2, 0.6],
        [0.2, 1.0, 0.9],
        [0.6, 0.9, 1.0]
      ],
      'viridis',
      {
        seedParcelId: 2,
        range: [0, 1],
        threshold: 0.5
      }
    );

    expect(layer).toBeInstanceOf(ParcelConnectivityLayer);
    let rgba = layer.getRGBAData(3);
    expect(rgba[3]).toBe(0);
    expect(rgba[7]).toBeGreaterThan(0);
    expect(rgba[11]).toBeGreaterThan(0);

    surface.setVertexLabels([3, 3, 1]);
    rgba = layer.getRGBAData(3);
    expect(rgba[3]).toBeGreaterThan(0);
    expect(rgba[7]).toBeGreaterThan(0);
    expect(rgba[11]).toBe(0);
  });
});
