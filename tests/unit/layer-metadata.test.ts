import { afterEach, describe, expect, expectTypeOf, it, vi } from 'vitest';
import { MultiLayerNeuroSurface } from '../../src/MultiLayerNeuroSurface';
import { SurfaceGeometry } from '../../src/classes';
import { DataLayer } from '../../src/layers';
import { TemporalDataLayer } from '../../src/temporal/TemporalDataLayer';
import type {
  LayerDataSummary,
  LayerPresentation
} from '../../src/layers';

afterEach(() => {
  vi.unstubAllGlobals();
});

function makeLayer(
  data: Float32Array | number[],
  presentation?: Partial<LayerPresentation>
): DataLayer {
  return new DataLayer('activation', data, null, 'viridis', { presentation });
}

describe('layer presentation metadata', () => {
  it('uses the stable layer id as the fallback label', () => {
    const presentation = makeLayer([1]).getPresentation();

    expect(presentation).toEqual({ label: 'activation' });
    expect(Object.isFrozen(presentation)).toBe(true);
    expectTypeOf(presentation).toEqualTypeOf<LayerPresentation>();
  });

  it('attaches immutable metadata without retaining mutable provenance input', () => {
    const provenance = {
      pipeline: 'fmriprep',
      parameters: { smoothing: 4 },
      sources: ['contrast.nii.gz']
    };
    const layer = makeLayer([1], {
      label: 'Task activation',
      description: 'Language contrast',
      units: 'z',
      provenance,
      missingValueLabel: 'Not estimated'
    });

    provenance.parameters.smoothing = 8;
    provenance.sources.push('later.nii.gz');
    const presentation = layer.getPresentation();

    expect(presentation).toEqual({
      label: 'Task activation',
      description: 'Language contrast',
      units: 'z',
      provenance: {
        pipeline: 'fmriprep',
        parameters: { smoothing: 4 },
        sources: ['contrast.nii.gz']
      },
      missingValueLabel: 'Not estimated'
    });
    expect(Object.isFrozen(presentation.provenance)).toBe(true);
    expect(Object.isFrozen(presentation.provenance?.parameters)).toBe(true);
    expect(Object.isFrozen(presentation.provenance?.sources)).toBe(true);
  });

  it('publishes presentation changes without marking scalar data as changed', () => {
    const layer = makeLayer([1, 2]);
    const changed = vi.fn();
    layer._onChangeCallback = changed;
    const revision = layer.getDataRevision();
    const summary = layer.getDataSummary();

    layer.setPresentation({ label: 'Updated', units: 'mm' });

    expect(layer.getPresentation()).toEqual({ label: 'Updated', units: 'mm' });
    expect(changed).toHaveBeenCalledWith({ presentation: { label: 'Updated', units: 'mm' } });
    expect(layer.getDataRevision()).toBe(revision);
    expect(layer.getDataSummary()).toBe(summary);
  });
});

describe('scalar layer data summaries', () => {
  it('counts finite and missing values and handles non-finite extrema', () => {
    const layer = makeLayer([Number.NaN, Infinity, -Infinity, -2, 4]);

    expect(layer.getDataSummary()).toEqual({
      finiteCount: 2,
      missingCount: 3,
      minimum: -2,
      maximum: 4
    });
  });

  it('returns null extrema for empty and wholly missing data', () => {
    expect(makeLayer([]).getDataSummary()).toEqual({
      finiteCount: 0,
      missingCount: 0,
      minimum: null,
      maximum: null
    });
    expect(makeLayer([NaN, Infinity]).getDataSummary()).toEqual({
      finiteCount: 0,
      missingCount: 2,
      minimum: null,
      maximum: null
    });
  });

  it('counts unmapped sparse-domain vertices and mapped missing values', () => {
    vi.stubGlobal('requestAnimationFrame', () => 1);
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    const geometry = new SurfaceGeometry(
      new Float32Array([
        0, 0, 0,
        1, 0, 0,
        0, 1, 0,
        0, 0, 1,
        1, 1, 0
      ]),
      new Uint32Array([0, 1, 2]),
      'left'
    );
    const surface = new MultiLayerNeuroSurface(geometry);
    const layer = new DataLayer(
      'sparse',
      new Float32Array([1, NaN]),
      new Uint32Array([0, 3]),
      'viridis'
    );
    surface.addLayer(layer);

    expect(layer.getDataSummary()).toEqual({
      finiteCount: 1,
      missingCount: 4,
      minimum: 1,
      maximum: 1
    });
    surface.dispose();
  });

  it('computes deterministic histograms lazily and caches parameter variants', () => {
    const layer = makeLayer([0, 1, 2, 3, 4]);
    const base = layer.getDataSummary();
    expect(base.histogram).toBeUndefined();

    const twoBins = layer.getDataSummary({ histogram: { bins: 2 } });
    const sameTwoBins = layer.getDataSummary({ histogram: { bins: 2 } });
    const fourBins = layer.getDataSummary({ histogram: { bins: 4 } });

    expect(twoBins).toBe(sameTwoBins);
    expect(twoBins.histogram).toEqual({
      edges: [0, 2, 4],
      counts: [2, 3]
    });
    expect(Object.isFrozen(twoBins)).toBe(true);
    expect(Object.isFrozen(twoBins.histogram)).toBe(true);
    expect(Object.isFrozen(twoBins.histogram?.edges)).toBe(true);
    expect(fourBins).not.toBe(twoBins);
    expect(layer.getDataSummary({ histogram: { bins: 2 } })).toBe(twoBins);
  });

  it('invalidates summaries only for data or domain changes', () => {
    const layer = makeLayer([0, 1, 2]);
    const summary = layer.getDataSummary({ histogram: { bins: 3 } });
    const revision = layer.getDataRevision();

    layer.setOpacity(0.5);
    layer.setRange([-1, 3]);
    layer.setThreshold([0, 0.5]);
    layer.setPresentation({ label: 'Stable cache' });
    expect(layer.getDataRevision()).toBe(revision);
    expect(layer.getDataSummary({ histogram: { bins: 3 } })).toBe(summary);

    layer._setDataSummaryDomainSize(5);
    const domainSummary = layer.getDataSummary({ histogram: { bins: 3 } });
    expect(domainSummary).not.toBe(summary);
    expect(domainSummary.missingCount).toBe(2);

    layer.setData([10, 20, NaN]);
    expect(layer.getDataRevision()).toBe(revision + 1);
    const changed = layer.getDataSummary({ histogram: { bins: 3 } });
    expect(changed).not.toBe(domainSummary);
    expect(changed).toMatchObject({
      finiteCount: 2,
      missingCount: 3,
      minimum: 10,
      maximum: 20
    });
  });

  it('invalidates temporal summaries when displayed scalar data changes in place', () => {
    const layer = new TemporalDataLayer(
      'bold',
      [new Float32Array([0, 2]), new Float32Array([2, 4])],
      [0, 1],
      'viridis',
      {}
    );
    const before = layer.getDataSummary();
    const revision = layer.getDataRevision();

    layer.setTime(0, 1, 0.5);

    expect(layer.getDataRevision()).toBe(revision + 1);
    expect(layer.getDataSummary()).not.toBe(before);
    expect(layer.getDataSummary()).toEqual({
      finiteCount: 2,
      missingCount: 0,
      minimum: 1,
      maximum: 3
    });
  });

  it('returns compact descriptors without raw scalar arrays', () => {
    const summary: LayerDataSummary = makeLayer([1, 2, 3]).getDataSummary({ histogram: true });

    expect(Object.values(summary).some(value => ArrayBuffer.isView(value))).toBe(false);
    expect(Object.keys(summary)).toEqual([
      'finiteCount',
      'missingCount',
      'minimum',
      'maximum',
      'histogram'
    ]);
  });
});
