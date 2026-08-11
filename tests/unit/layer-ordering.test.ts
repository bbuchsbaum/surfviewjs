import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConnectivityLayer } from '../../src/ConnectivityLayer';
import { GPULayerCompositor } from '../../src/GPULayerCompositor';
import {
  BaseLayer,
  DataLayer,
  LayerStack
} from '../../src/layers';
import { CurvatureLayer } from '../../src/layers/CurvatureLayer';
import { OutlineLayer } from '../../src/OutlineLayer';

afterEach(() => {
  vi.restoreAllMocks();
});

function dataLayer(id: string, order: number, opacity: number = 1): DataLayer {
  return new DataLayer(id, new Float32Array([order]), null, 'viridis', {
    order,
    opacity
  });
}

function makeConstrainedStack(): LayerStack {
  const stack = new LayerStack();
  stack.addLayer(new ConnectivityLayer('connections', [
    { source: 0, target: 1, weight: 1 }
  ]));
  stack.addLayer(dataLayer('high', 20));
  stack.addLayer(new OutlineLayer('outline', {
    roiLabels: new Uint32Array([1, 1])
  }));
  stack.addLayer(new BaseLayer());
  stack.addLayer(new CurvatureLayer('curvature', new Float32Array([0, 1]), { order: 100 }));
  stack.addLayer(dataLayer('low', 1));
  return stack;
}

describe('canonical layer ordering', () => {
  it('uses one constrained bottom-to-top order for listing and compositing', () => {
    const stack = makeConstrainedStack();
    const expected = ['curvature', 'base', 'low', 'high', 'outline', 'connections'];

    expect(stack.getOrderedLayers().map(layer => layer.id)).toEqual(expected);
    expect(stack.getAllLayers().map(layer => layer.id)).toEqual(expected);
    expect(stack.getVisibleLayers().map(layer => layer.id)).toEqual(expected);
    expect(stack.getLayerOrderDescriptors()).toEqual([
      { id: 'curvature', index: 0, role: 'anatomy', pinned: 'bottom', reorderable: false },
      { id: 'base', index: 1, role: 'anatomy', pinned: 'bottom', reorderable: false },
      { id: 'low', index: 2, role: 'data', pinned: null, reorderable: true },
      { id: 'high', index: 3, role: 'data', pinned: null, reorderable: true },
      { id: 'outline', index: 4, role: 'outline', pinned: 'top', reorderable: false },
      { id: 'connections', index: 5, role: 'connectivity', pinned: 'top', reorderable: false }
    ]);
  });

  it('accepts a complete legal order atomically and reports no-op commands', () => {
    const stack = makeConstrainedStack();

    const moved = stack.setLayerOrder([
      'curvature', 'base', 'high', 'low', 'outline', 'connections'
    ]);
    expect(moved).toEqual({
      ok: true,
      changed: true,
      order: ['curvature', 'base', 'high', 'low', 'outline', 'connections']
    });
    expect(stack.getVisibleLayers().map(layer => layer.id)).toEqual(moved.ok ? moved.order : []);

    const unchanged = stack.setLayerOrder(moved.ok ? moved.order : []);
    expect(unchanged).toMatchObject({ ok: true, changed: false });
  });

  it('validates a candidate order without mutating compositing order', () => {
    const stack = makeConstrainedStack();
    const candidate = ['curvature', 'base', 'high', 'low', 'outline', 'connections'];

    expect(stack.validateLayerOrder(candidate)).toEqual({
      ok: true,
      changed: true,
      order: candidate
    });
    expect(stack.getVisibleLayers().map(layer => layer.id)).toEqual([
      'curvature', 'base', 'low', 'high', 'outline', 'connections'
    ]);
  });

  it('rejects incomplete, duplicate, unknown, and constraint-breaking orders without mutation', () => {
    const stack = makeConstrainedStack();
    const original = stack.getOrderedLayers().map(layer => layer.id);
    const invalidOrders = [
      {
        ids: original.slice(0, -1),
        code: 'incomplete-order'
      },
      {
        ids: ['curvature', 'base', 'low', 'low', 'outline', 'connections'],
        code: 'duplicate-layer-id'
      },
      {
        ids: ['curvature', 'base', 'low', 'high', 'outline', 'missing'],
        code: 'layer-not-found'
      },
      {
        ids: ['low', 'curvature', 'base', 'high', 'outline', 'connections'],
        code: 'constraint-violation'
      },
      {
        ids: ['base', 'curvature', 'low', 'high', 'outline', 'connections'],
        code: 'constraint-violation'
      },
      {
        ids: ['curvature', 'base', 'low', 'high', 'connections', 'outline'],
        code: 'constraint-violation'
      }
    ] as const;

    for (const invalid of invalidOrders) {
      expect(stack.setLayerOrder(invalid.ids)).toMatchObject({
        ok: false,
        code: invalid.code
      });
      expect(stack.getOrderedLayers().map(layer => layer.id)).toEqual(original);
    }
  });

  it('moves reorderable data only within the legal middle region', () => {
    const stack = makeConstrainedStack();

    expect(stack.moveLayer('high', 2)).toMatchObject({ ok: true, changed: true });
    expect(stack.getOrderedLayers().map(layer => layer.id)).toEqual([
      'curvature', 'base', 'high', 'low', 'outline', 'connections'
    ]);

    expect(stack.moveLayer('high', 0)).toMatchObject({
      ok: false,
      code: 'constraint-violation'
    });
    expect(stack.moveLayer('base', 2)).toMatchObject({
      ok: false,
      code: 'layer-not-reorderable'
    });
    expect(stack.moveLayer('curvature', 1)).toMatchObject({
      ok: false,
      code: 'layer-not-reorderable'
    });
    expect(stack.moveLayer('outline', 3)).toMatchObject({
      ok: false,
      code: 'layer-not-reorderable'
    });
    expect(stack.moveLayer('connections', 4)).toMatchObject({
      ok: false,
      code: 'layer-not-reorderable'
    });
    expect(stack.moveLayer('missing', 1)).toMatchObject({
      ok: false,
      code: 'layer-not-found'
    });
    expect(stack.moveLayer('low', -1)).toMatchObject({
      ok: false,
      code: 'invalid-destination'
    });
  });

  it('treats Layer.order as an initialization hint and ignores attached writes visibly', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const layer = dataLayer('data', 5);
    layer.order = -5;
    const stack = new LayerStack();
    stack.addLayer(new BaseLayer());
    stack.addLayer(layer);

    layer.order = 99;

    expect(layer.order).toBe(-5);
    expect(stack.getOrderedLayers().map(item => item.id)).toEqual(['base', 'data']);
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0][0]).toContain('initialization hint');
  });

  it('feeds the canonical order directly into the GPU compositor slots', () => {
    const stack = new LayerStack();
    const first = dataLayer('first', 2, 0.2);
    const second = dataLayer('second', 1, 0.8);
    stack.addLayer(first);
    stack.addLayer(second);
    expect(stack.setLayerOrder(['first', 'second'])).toMatchObject({ ok: true });

    const compositor = new GPULayerCompositor(1, 2);
    compositor.updateLayers(stack.getVisibleLayers());
    const uniforms = (compositor as any).material.uniforms;

    expect(uniforms.layerOpacity.value[0]).toBeCloseTo(0.2, 6);
    expect(uniforms.layerOpacity.value[1]).toBeCloseTo(0.8, 6);
    expect(uniforms.layerCount.value).toBe(2);
    compositor.dispose();
  });
});
