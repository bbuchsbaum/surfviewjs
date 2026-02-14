import { describe, it, expect } from 'vitest';
import {
  validateParcelData,
  validateAtlasRef,
  mapParcelValuesToVertices,
  parcelValuesInOrder,
  type ParcelData,
  type AtlasRef
} from '../../src/parcellation';

function makeParcelData(): ParcelData {
  return {
    schema_version: '1.0.0',
    atlas: {
      id: 'toy_atlas',
      name: 'Toy Atlas',
      n_parcels: 3,
      family: 'toy',
      model: 'ToyModel',
      representation: 'surface',
      coord_space: 'MNI152',
      confidence: 'high'
    },
    parcels: [
      { id: 1, label: 'A', hemi: 'left', value: 10, score: 1.5 },
      { id: 2, label: 'B', hemi: 'right', value: -2, score: 0.5 },
      { id: 3, label: 'C', hemi: 'left', value: 7, score: -0.25 }
    ]
  };
}

describe('parcellation schema', () => {
  it('validates a well-formed ParcelData object', () => {
    const data = makeParcelData();
    expect(validateParcelData(data)).toBe(data);
  });

  it('rejects duplicate parcel ids', () => {
    const data = makeParcelData();
    data.parcels[2].id = 2;
    expect(() => validateParcelData(data)).toThrow(/unique/i);
  });

  it('rejects atlas n_parcels mismatch in strict mode', () => {
    const data = makeParcelData();
    data.atlas.n_parcels = 99;
    expect(() => validateParcelData(data)).toThrow(/n_parcels/i);
  });

  it('validates AtlasRef confidence/representation enums', () => {
    const ref: AtlasRef = {
      family: 'schaefer',
      model: 'Schaefer2018',
      representation: 'surface',
      confidence: 'exact'
    };
    expect(validateAtlasRef(ref)).toBe(ref);
  });

  it('rejects invalid AtlasRef confidence', () => {
    const bad = {
      family: 'schaefer',
      model: 'Schaefer2018',
      representation: 'surface',
      confidence: 'maybe'
    } as any;

    expect(() => validateAtlasRef(bad)).toThrow(/confidence/i);
  });
});

describe('parcel value mapping', () => {
  it('maps parcel values to vertices by parcel id', () => {
    const data = makeParcelData();
    const vertexLabels = new Uint32Array([1, 1, 2, 3, 9]);

    const values = mapParcelValuesToVertices(vertexLabels, data, 'value');

    expect(values[0]).toBe(10);
    expect(values[1]).toBe(10);
    expect(values[2]).toBe(-2);
    expect(values[3]).toBe(7);
    expect(Number.isNaN(values[4])).toBe(true);
  });

  it('returns values in explicit parcel id order', () => {
    const data = makeParcelData();
    const values = parcelValuesInOrder(data, [3, 1, 5], 'score');

    expect(values[0]).toBeCloseTo(-0.25, 6);
    expect(values[1]).toBeCloseTo(1.5, 6);
    expect(Number.isNaN(values[2])).toBe(true);
  });

  it('throws for non-numeric value columns', () => {
    const data = makeParcelData();
    data.parcels[0].category = 'visual';

    expect(() => mapParcelValuesToVertices([1, 2, 3], data, 'category')).toThrow(/numeric/i);
  });
});
