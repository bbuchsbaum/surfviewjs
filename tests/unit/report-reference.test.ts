// @vitest-environment jsdom
import { ReferenceLayer } from '../../src/layers/ReferenceLayer';
import { webcrypto } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { createSceneAsset, mountSurfView, createSurfViewControlSession } from '../../src';
import { ReportControls } from '../../src/report/ReportControls';
import { makeReportFixture } from './report-scene-fixture';

describe('persistent report references', () => {
  it('preserves reference state and order through A→B→A, views and mapping changes', () => {
    const fixture = makeReportFixture(true);
    const { target, left, right } = fixture;
    const session = createSurfViewControlSession(target);
    const address = { surfaceId: 'lh', layerId: 'reference' };
    try {
      const initial = target.getSnapshot();
      expect(initial.capabilities.exclusiveMap?.availableLayerIds).toEqual(['response', 'uncertainty']);
      expect(initial.capabilities.referenceLayers?.layers[0]).toMatchObject({ visible: true, opacity: 0.2 });
      expect(Object.isFrozen(initial.capabilities.referenceLayers?.layers[0])).toBe(true);
      expect(session.setLayerVisibility(address, false)).toEqual({ ok: true });
      expect(session.setLayerOpacity(address, 0.6)).toEqual({ ok: true });
      for (const id of ['uncertainty', 'response']) {
        expect(session.setDisplayedLayer(id)).toEqual({ ok: true });
        expect(target.getSnapshot().capabilities.exclusiveMap?.displayedLayerId).toBe(id);
        for (const surface of [left, right]) {
          expect(surface.getLayer('reference')).toMatchObject({ visible: false, opacity: 0.6 });
          expect(surface.layerStack.getAllLayers().map(layer => layer.id)).toEqual(['base', 'reference', 'response', 'uncertainty']);
          expect(surface.getLayer('response')?.visible).toBe(id === 'response');
          expect(surface.getLayer('uncertainty')?.visible).toBe(id === 'uncertainty');
        }
      }
      expect(session.updateScalarMapping({ surfaceId: 'lh', layerId: 'response' }, {
        displayRange: [-4, 6], maskInterval: [-1, 1], colorMapId: 'magma'
      })).toEqual({ ok: true });
      expect(session.setAnatomicalView({ view: 'medial', target: { kind: 'group', groupId: 'cortex' } })).toEqual({ ok: true });
      expect(left.getLayer('reference')).toMatchObject({ visible: false, opacity: 0.6 });
      expect(initial.capabilities.referenceLayers?.layers[0]).toMatchObject({ visible: true, opacity: 0.2 });
      expect(session.resetView()).toEqual({ ok: true });
      for (const surface of [left, right]) expect(surface.getLayer('reference')).toMatchObject({ visible: true, opacity: 0.2 });
      expect(target.getSnapshot().capabilities.exclusiveMap?.displayedLayerId).toBe('response');
    } finally { session.dispose(); fixture.dispose(); }
  });

  it('rejects reference selection, map visibility, invalid addresses and values without mutation', () => {
    const fixture = makeReportFixture(true);
    const { target } = fixture;
    const address = { surfaceId: 'lh', layerId: 'reference' };
    try {
      const before = target.getSnapshot();
      expect(target.setDisplayedLayer('reference')).toMatchObject({ ok: false, code: 'invalid-value' });
      expect(target.setDisplayedLayer('missing')).toMatchObject({ ok: false, code: 'layer-not-found' });
      expect(target.setLayerVisibility({ ...address, layerId: 'response' }, true)).toMatchObject({ ok: false, code: 'unsupported' });
      expect(target.setLayerVisibility({ ...address, surfaceId: 'missing' }, false)).toMatchObject({ ok: false, code: 'surface-not-found' });
      expect(target.setLayerVisibility(address, 1 as unknown as boolean)).toMatchObject({ ok: false, code: 'invalid-value' });
      for (const opacity of [-1, 2, NaN, Infinity]) expect(target.setLayerOpacity(address, opacity)).toMatchObject({ ok: false, code: 'invalid-value' });
      expect(target.setLayerBlendMode(address, 'additive')).toMatchObject({ ok: false, code: 'unsupported' });
      expect(target.updateScalarMapping(address, { displayRange: [0, 2] })).toMatchObject({ ok: false, code: 'unsupported' });
      expect(target.getSnapshot()).toBe(before);
      target.dispose();
      expect(target.setLayerVisibility(address, false)).toMatchObject({ ok: false, code: 'disposed' });
      expect(target.setLayerOpacity(address, 0.5)).toMatchObject({ ok: false, code: 'disposed' });
    } finally { fixture.dispose(); }
  });

  it('offers a categorical label/swatch and native separately labelled controls', async () => {
    const fixture = makeReportFixture(true);
    const controls = new ReportControls(fixture.target);
    document.body.appendChild(controls.element);
    try {
      const group = [...controls.element.querySelectorAll('fieldset')].find(fieldset => fieldset.querySelector('legend')?.textContent === 'Anatomical reference')!;
      expect(group.hidden).toBe(false);
      const checkbox = group.querySelector<HTMLInputElement>('input[type=checkbox]')!;
      checkbox.click();
      await Promise.resolve();
      expect(fixture.left.getLayer('reference')?.visible).toBe(false);
      const opacity = group.querySelector<HTMLInputElement>('input[type=range]')!;
      opacity.value = '0.5';
      opacity.dispatchEvent(new Event('input'));
      await Promise.resolve();
      expect(fixture.right.getLayer('reference')?.opacity).toBe(0.5);
      expect(controls.element.querySelectorAll('option')).toHaveLength(2);
      expect(fixture.target.getSnapshot().surfaces[0]?.layers.find(layer => layer.id === 'reference')).toMatchObject({
        colorPreview: { kind: 'categorical', css: '#ff0000' }
      });
    } finally { controls.dispose(); fixture.dispose(); }
  });

  it('publishes complete bilateral changes atomically and fails reset without partial mutation', () => {
    const fixture = makeReportFixture(true);
    const delivered: unknown[] = [];
    const subscription = fixture.target.subscribe(snapshot => {
      delivered.push(snapshot.surfaces.map(surface => surface.layers.find(layer => layer.id === 'reference')?.visible));
    });
    try {
      fixture.target.setLayerVisibility({ surfaceId: 'lh', layerId: 'reference' }, false);
      expect(delivered).toEqual([[true, true], [false, false]]);
      fixture.target.setAnatomicalView({ view: 'medial', target: { kind: 'group', groupId: 'cortex' } });
      fixture.left.removeLayer('reference');
      const before = fixture.target.getSnapshot();
      expect(fixture.target.resetView()).toMatchObject({ ok: false, code: 'layer-not-found' });
      expect(fixture.target.getSnapshot()).toBe(before);
      expect(fixture.right.getLayer('reference')?.visible).toBe(false);
    } finally { subscription.unsubscribe(); fixture.dispose(); }
  });

  it('rejects nonbinary asset bytes before allocating a viewer and can dispose the failure', async () => {
    vi.stubGlobal('crypto', webcrypto);
    const container = document.createElement('div');
    document.body.appendChild(container);
    try {
      const vertices = await createSceneAsset([0,0,0, 0,1,0, 0,0,1], { role: 'vertices', dtype: 'float32', shape: [3,3] });
      const faces = await createSceneAsset([0,1,2], { role: 'faces', dtype: 'uint32', shape: [1,3] });
      const badMask = await createSceneAsset([0,0.5,1], { role: 'values', dtype: 'float32', shape: [3] });
      const descriptors = [vertices, faces, badMask].map(asset => asset.descriptor);
      const onError = vi.fn();
      const handle = mountSurfView(container, {
        schemaVersion: 'surfview.scene.v2', id: 'bad-mask',
        assets: Object.fromEntries(descriptors.map(asset => [asset.id, asset])),
        geometries: { left: { id: 'left', hemisphere: 'left', vertices: vertices.descriptor.id, faces: faces.descriptor.id, vertexCount: 3, faceCount: 1 } },
        layers: {
          map: { id: 'map', values: { left: { values: badMask.descriptor.id } }, colorMap: 'viridis', limits: [0,1] },
          reference: { id: 'reference', role: 'reference', label: 'Region', color: '#ff0000', boundary: 'midpoint', values: { left: { values: badMask.descriptor.id } } }
        }
      }, { lazy: false, onError });
      await expect(handle.ready).rejects.toThrow('membership must be binary');
      expect(handle.viewer).toBeNull();
      expect(handle.controlTarget).toBeNull();
      expect(container.querySelector('canvas')).toBeNull();
      expect(onError).toHaveBeenCalledOnce();
      handle.dispose();
      expect(container.childElementCount).toBe(0);
    } finally { container.remove(); vi.unstubAllGlobals(); }
  });

  it('validates binary membership before Float32 conversion and owns its data', () => {
    for (const value of [NaN, Infinity, -1, 0.5, 1.000000001]) expect(() => new ReferenceLayer('ref', [value], '#ff0000')).toThrow('binary');
    const source = new Float32Array([0, 1]);
    const layer = new ReferenceLayer('ref', source, '#ff0000');
    source.fill(0);
    expect(Array.from(layer.getRGBAData(2))).toEqual([1, 0, 0, 0, 1, 0, 0, 1]);
    expect(() => layer.getRGBAData(3)).toThrow('vertex count');
  });
});
