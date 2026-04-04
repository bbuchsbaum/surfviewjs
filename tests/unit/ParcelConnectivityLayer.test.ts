import { describe, expect, it } from 'vitest';
import { ParcelConnectivityLayer } from '../../src/layers/ParcelConnectivityLayer';
import type { ParcelData } from '../../src/parcellation';

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
      { id: 1, label: 'A', hemi: 'left' },
      { id: 2, label: 'B', hemi: 'left' },
      { id: 3, label: 'C', hemi: 'left' }
    ]
  };
}

describe('ParcelConnectivityLayer', () => {
  it('maps the seeded parcel row back onto parcel labels with thresholded alpha', () => {
    const layer = new ParcelConnectivityLayer(
      'conn',
      [
        [1.0, 0.4, -0.2],
        [0.4, 1.0, 0.8],
        [-0.2, 0.8, 1.0]
      ],
      makeParcelData(),
      [1, 2, 3],
      'viridis',
      {
        seedParcelId: 2,
        range: [-1, 1],
        threshold: 0.3,
        alphaMode: 'magnitude',
        alphaRange: [0.2, 1]
      }
    );

    const rgba = layer.getRGBAData(3);
    expect(rgba[3]).toBeGreaterThan(0);
    expect(rgba[7]).toBeCloseTo(1, 6);
    expect(rgba[11]).toBeGreaterThan(rgba[3]);
    expect(layer.getConnectivityValue(3)).toBeCloseTo(0.8, 6);
  });

  it('supports remapped parcel id order and dynamic seed changes', () => {
    const layer = new ParcelConnectivityLayer(
      'conn',
      [
        [1.0, 0.1, 0.5],
        [0.1, 1.0, 0.7],
        [0.5, 0.7, 1.0]
      ],
      makeParcelData(),
      [1, 2, 3],
      'viridis',
      {
        parcelIds: [3, 1, 2],
        seedParcelId: 1,
        range: [0, 1],
        threshold: 0.5,
        alphaMode: 'constant'
      }
    );

    expect(layer.getConnectivityValue(2)).toBeCloseTo(0.7, 6);
    expect(layer.getConnectivityValue(3)).toBeCloseTo(0.1, 6);

    let rgba = layer.getRGBAData(3);
    expect(rgba[3]).toBeGreaterThan(0);
    expect(rgba[7]).toBeGreaterThan(0);
    expect(rgba[11]).toBe(0);

    layer.setSeedParcel(3);
    rgba = layer.getRGBAData(3);
    expect(rgba[3]).toBe(0);
    expect(rgba[7]).toBeGreaterThan(0);
    expect(rgba[11]).toBeGreaterThan(0);
  });

  it('can seed from a hovered vertex index', () => {
    const layer = new ParcelConnectivityLayer(
      'conn',
      [
        [1.0, 0.2, 0.6],
        [0.2, 1.0, 0.9],
        [0.6, 0.9, 1.0]
      ],
      makeParcelData(),
      [1, 2, 3]
    );

    layer.setSeedFromVertex(2);
    expect(layer.getSeedParcelId()).toBe(3);
    expect(layer.getConnectivityValue(2)).toBeCloseTo(0.9, 6);
  });
});
