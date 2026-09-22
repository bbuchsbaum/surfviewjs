import { describe, expect, it } from 'vitest';
import {
  builtInLayerRegistry,
  createLayerFromConfig,
  LayerRegistry,
  tryCreateLayerFromConfig
} from '../../src/LayerRegistry';
import type { BuiltInLayerConfig } from '../../src/LayerRegistry';
import { Layer } from '../../src/layers';
import type { LayerUpdateData } from '../../src/layers';

const configs: BuiltInLayerConfig[] = [
  { type: 'base', id: 'base', color: 0xabcdef },
  { type: 'rgba', id: 'rgba', data: new Float32Array([1, 0, 0, 1]) },
  { type: 'data', id: 'data', data: new Float32Array([1]), colorMap: 'viridis' },
  { type: 'outline', id: 'outline', roiLabels: new Uint32Array([1]) },
  {
    type: 'label',
    id: 'label',
    labels: new Uint32Array([1]),
    labelDefs: [{ id: 1, color: 0xff0000 }]
  },
  {
    type: 'twodata',
    id: 'twodata',
    dataX: new Float32Array([1]),
    dataY: new Float32Array([1])
  },
  {
    type: 'temporal',
    id: 'temporal',
    frames: [new Float32Array([1])],
    times: [0]
  },
  {
    type: 'volume',
    id: 'volume',
    volumeData: new Float32Array([1]),
    dims: [1, 1, 1]
  },
  { type: 'curvature', id: 'curvature', curvature: new Float32Array([0]) },
  { type: 'statistical', id: 'statistical', data: new Float32Array([1]) },
  {
    type: 'connectivity',
    id: 'connectivity',
    edges: [{ source: 0, target: 1, weight: 1 }]
  }
];

describe('LayerRegistry', () => {
  it('registers every built-in discriminant exactly once', () => {
    expect(builtInLayerRegistry.registeredTypes()).toEqual(configs.map(config => config.type));
  });

  it('constructs every built-in and preserves its discriminant in serialized state', () => {
    for (const config of configs) {
      const layer = createLayerFromConfig(config);
      const jsonRoundTrip = JSON.parse(JSON.stringify(layer.toStateJSON())) as {
        type?: unknown;
      };
      expect(jsonRoundTrip.type).toBe(config.type);
      layer.dispose();
    }
  });

  it('returns typed forward-compatible failures for malformed and unknown configs', () => {
    const malformed = tryCreateLayerFromConfig({ id: 'missing-type' });
    expect(malformed.ok).toBe(false);
    if (!malformed.ok) expect(malformed.error.code).toBe('invalid-config');

    const unknown = tryCreateLayerFromConfig({ type: 'future-layer', id: 'future' });
    expect(unknown.ok).toBe(false);
    if (!unknown.ok) {
      expect(unknown.error.code).toBe('unknown-type');
      expect(unknown.error.layerType).toBe('future-layer');
    }
  });

  it('supports inferred third-party registrations without mutating another registry', () => {
    interface CustomConfig {
      type: 'custom';
      id: string;
      gain: number;
    }
    class CustomLayer extends Layer {
      readonly gain: number;
      constructor(config: CustomConfig) {
        super(config.id);
        this.gain = config.gain;
      }
      getRGBAData(vertexCount: number): Float32Array {
        return new Float32Array(vertexCount * 4);
      }
      update(_updates: LayerUpdateData): void {}
    }

    const emptyRegistry = new LayerRegistry();
    const registry = builtInLayerRegistry.extend(
      'custom',
      (config: CustomConfig) => new CustomLayer(config)
    );
    const layer = registry.create({ type: 'custom', id: 'extension', gain: 2 });

    expect(layer).toBeInstanceOf(CustomLayer);
    expect(layer.gain).toBe(2);
    expect(emptyRegistry.has('custom')).toBe(false);
    expect(builtInLayerRegistry.has('custom')).toBe(false);
    expect(() => registry.register('custom', config => new CustomLayer(config))).toThrow(
      'already has a factory'
    );
  });

  it('rejects fields that are not valid for the target built-in update API', () => {
    const invalidFields: Record<string, string> = {
      base: 'data',
      rgba: 'range',
      data: 'frames',
      outline: 'data',
      label: 'colorMap',
      twodata: 'range',
      temporal: 'times',
      volume: 'dims',
      curvature: 'data',
      statistical: 'correctionMethod',
      connectivity: 'frames'
    };

    for (const config of configs) {
      const layer = createLayerFromConfig(config);
      const invalidField = invalidFields[config.type]!;
      const dynamicLayer = layer as unknown as {
        update(updates: Record<string, unknown>): void;
      };
      expect(() => dynamicLayer.update({ [invalidField]: 1 })).toThrow(
        `does not support field: ${invalidField}`
      );
      layer.dispose();
    }
  });

  it('rejects index remapping without replacement data', () => {
    const layer = createLayerFromConfig({
      type: 'data',
      id: 'data',
      data: new Float32Array([1])
    });
    expect(() => layer.update({ indices: new Uint32Array([0]) })).toThrow(
      'requires data when indices is provided'
    );
  });
});
