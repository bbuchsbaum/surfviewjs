import { afterEach, describe, expect, it, vi } from 'vitest';
import { GPULayerCompositor } from '../../src/GPULayerCompositor';
import { RGBALayer } from '../../src/layers';

afterEach(() => {
  vi.restoreAllMocks();
});

function rgbaLayer(id: string, vertexCount: number): RGBALayer {
  const data = new Float32Array(vertexCount * 4).fill(0.5);
  return new RGBALayer(id, data);
}

describe('GPULayerCompositor performance contracts', () => {
  it('regenerates only dirty or relocated texture slices', () => {
    const layers = [rgbaLayer('a', 10), rgbaLayer('b', 10), rgbaLayer('c', 10)];
    const reads = layers.map(layer => vi.spyOn(layer, 'getRGBAData'));
    const compositor = new GPULayerCompositor(10, 3);

    compositor.updateLayers(layers);
    expect(compositor.getLastUpdateStats()).toMatchObject({
      regeneratedLayerSlices: 3,
      clearedLayerSlices: 0
    });
    layers.forEach(layer => { layer.needsUpdate = false; });
    const layerTexture = (compositor as any).layerTexture;
    layerTexture.clearLayerUpdates();

    layers[1]!.needsUpdate = true;
    compositor.updateLayers(layers);
    expect(reads.map(spy => spy.mock.calls.length)).toEqual([1, 2, 1]);
    expect(compositor.getLastUpdateStats()).toMatchObject({
      regeneratedLayerSlices: 1,
      clearedLayerSlices: 0,
      textureBytesMarkedForUpload: 256
    });
    expect([...layerTexture.layerUpdates]).toEqual([1]);
    layers[1]!.needsUpdate = false;

    compositor.updateLayers([layers[0]!, layers[2]!, layers[1]!]);
    expect(reads.map(spy => spy.mock.calls.length)).toEqual([1, 3, 2]);
    expect(compositor.getLastUpdateStats()).toMatchObject({
      regeneratedLayerSlices: 2,
      clearedLayerSlices: 0
    });
    compositor.dispose();
  });

  it('clears vacated slots once and reports allocated texture bytes', () => {
    const compositor = new GPULayerCompositor(10, 3);
    const layers = [rgbaLayer('a', 10), rgbaLayer('b', 10), rgbaLayer('c', 10)];
    compositor.updateLayers(layers);
    layers.forEach(layer => { layer.needsUpdate = false; });

    compositor.updateLayers([layers[0]!]);
    expect(compositor.getLastUpdateStats()).toMatchObject({
      regeneratedLayerSlices: 0,
      clearedLayerSlices: 2,
      textureBytesMarkedForUpload: 512
    });
    compositor.updateLayers([layers[0]!]);
    expect(compositor.getLastUpdateStats()).toMatchObject({
      regeneratedLayerSlices: 0,
      clearedLayerSlices: 0,
      textureBytesMarkedForUpload: 0
    });
    expect(compositor.getTextureMemoryUsage()).toEqual({
      layerTextureBytes: 768,
      volumeColormapBytes: 3072,
      totalBytes: 3840
    });
    compositor.dispose();
  });

  it('validates the shader texture-unit and texture-size requirements', () => {
    const capable = GPULayerCompositor.assessCapacity({
      capabilities: {
        isWebGL2: true,
        maxVertexTextures: 16,
        maxTextureSize: 4096
      }
    } as any, 324_000, 8);
    expect(capable).toMatchObject({
      supported: true,
      requiredVertexTextureUnits: 10,
      requiredTextureSize: 570
    });
    expect(GPULayerCompositor.assessCapacity({
      capabilities: {
        isWebGL2: true,
        maxVertexTextures: 9,
        maxTextureSize: 4096
      }
    } as any, 32_492, 1)).toMatchObject({
      supported: false,
      requiredVertexTextureUnits: 10
    });

    expect(GPULayerCompositor.assessCapacity({
      capabilities: {
        isWebGL2: true,
        maxVertexTextures: 8,
        maxTextureSize: 4096
      }
    } as any, 324_000, 8)).toMatchObject({
      supported: false,
      reason: 'requires 10 vertex texture units, found 8'
    });
  });
});
