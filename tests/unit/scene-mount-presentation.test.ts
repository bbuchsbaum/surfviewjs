import { describe, expect, it } from 'vitest';
import { createSceneDataLayer } from '../../src/report/SceneMount';
import type { SurfViewSceneLayerManifest } from '../../src/scene';

function layerManifest(
  overrides: Partial<SurfViewSceneLayerManifest> = {}
): SurfViewSceneLayerManifest {
  return {
    id: 'contrast',
    values: { left: { values: 'values' } },
    colorMap: 'viridis',
    limits: [-3, 3],
    ...overrides
  };
}

const values = new Float32Array([-1, 0, 2]);

describe('report scene layer presentation', () => {
  it('carries the manifest label, units and provenance into the layer', () => {
    const layer = createSceneDataLayer(
      layerManifest({
        label: 'Task contrast',
        units: 'z',
        provenance: { source: 'fixture' }
      }),
      values,
      null,
      true
    );

    expect(layer.getPresentation()).toEqual({
      label: 'Task contrast',
      units: 'z',
      provenance: { source: 'fixture' }
    });
    expect(layer.visible).toBe(true);
    expect(layer.getRange()).toEqual([-3, 3]);
  });

  it('prefers the legend title and units, matching the control target', () => {
    const layer = createSceneDataLayer(
      layerManifest({
        label: 'Task contrast',
        units: 'beta',
        legend: { title: 'Contrast key', units: 'z' }
      }),
      values,
      null,
      false
    );

    expect(layer.getPresentation()).toEqual({ label: 'Contrast key', units: 'z' });
    expect(layer.visible).toBe(false);
  });

  it('falls back to the layer id when the manifest has no presentation', () => {
    const layer = createSceneDataLayer(
      layerManifest({ threshold: [-1, 1] }),
      values,
      null,
      true
    );

    expect(layer.getPresentation()).toEqual({ label: 'contrast' });
    expect(layer.getThreshold()).toEqual([-1, 1]);
  });
});
