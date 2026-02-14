import { describe, it, expect } from 'vitest';
import { ParcelValueLayer } from '../../src/layers/ParcelValueLayer';
import type { ParcelData } from '../../src/parcellation';

function makeParcelData(): ParcelData {
  return {
    schema_version: '1.0.0',
    atlas: {
      id: 'toy_atlas',
      name: 'Toy Atlas',
      n_parcels: 3,
      representation: 'surface',
      confidence: 'high'
    },
    parcels: [
      { id: 1, label: 'A', hemi: 'left', value: 1.0, alt: 10 },
      { id: 2, label: 'B', hemi: 'right', value: 2.0, alt: 20 },
      { id: 3, label: 'C', hemi: 'left', value: 3.0, alt: 30 }
    ]
  };
}

describe('ParcelValueLayer', () => {
  it('expands parcel values to vertex data on construction', () => {
    const layer = new ParcelValueLayer(
      'parcel',
      makeParcelData(),
      new Uint32Array([1, 2, 3, 9]),
      'viridis',
      { valueColumn: 'value', range: [0, 3] }
    );

    const values = layer.getData();
    expect(values).not.toBeNull();
    expect(values![0]).toBe(1);
    expect(values![1]).toBe(2);
    expect(values![2]).toBe(3);
    expect(Number.isNaN(values![3])).toBe(true);
  });

  it('renders missing parcel ids as transparent vertices', () => {
    const layer = new ParcelValueLayer(
      'parcel',
      makeParcelData(),
      [1, 2, 99],
      'hot',
      { valueColumn: 'value', range: [0, 3] }
    );

    const rgba = layer.getRGBAData(3);
    expect(rgba[0 * 4 + 3]).toBeGreaterThan(0);
    expect(rgba[1 * 4 + 3]).toBeGreaterThan(0);
    expect(rgba[2 * 4 + 3]).toBe(0);
  });

  it('supports switching value columns', () => {
    const layer = new ParcelValueLayer(
      'parcel',
      makeParcelData(),
      [1, 2, 3],
      'viridis',
      { valueColumn: 'value', range: [0, 30] }
    );

    layer.setValueColumn('alt');
    const values = layer.getData()!;

    expect(values[0]).toBe(10);
    expect(values[1]).toBe(20);
    expect(values[2]).toBe(30);
    expect(layer.getValueColumn()).toBe('alt');
  });

  it('exposes parcel metadata/value queries', () => {
    const layer = new ParcelValueLayer('parcel', makeParcelData(), [1, 3], 'jet');

    const row = layer.getParcelMetadata(3);
    expect(row).not.toBeNull();
    expect(row?.label).toBe('C');

    expect(layer.getParcelValue(1)).toBe(1);
    expect(layer.getParcelValue(99)).toBeNull();
  });

  it('updates parcel data and vertex labels via update()', () => {
    const layer = new ParcelValueLayer('parcel', makeParcelData(), [1, 1, 1], 'jet');

    const next = makeParcelData();
    next.parcels[0].value = 42;

    layer.update({
      parcelData: next,
      vertexLabels: [1, 2, 3],
      valueColumn: 'value'
    });

    const values = layer.getData()!;
    expect(values[0]).toBe(42);
    expect(values[1]).toBe(2);
    expect(values[2]).toBe(3);
  });

  it('serializes minimal parcel state metadata', () => {
    const layer = new ParcelValueLayer('parcel', makeParcelData(), [1, 2, 3], 'jet');
    const state = layer.toStateJSON();

    expect(state.type).toBe('parcel');
    expect(state.atlasId).toBe('toy_atlas');
    expect(state.parcelCount).toBe(3);
    expect(state.valueColumn).toBe('value');
  });
});
