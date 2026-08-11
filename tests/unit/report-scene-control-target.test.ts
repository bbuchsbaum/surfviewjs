import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SurfViewControlSnapshot } from '../../src';
import { runControlTargetContractLaws } from './control-target-laws';
import { makeReportFixture } from './report-scene-fixture';

beforeEach(() => {
  vi.stubGlobal('requestAnimationFrame', () => 1);
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

runControlTargetContractLaws('ReportSceneControlTarget', () => {
  const fixture = makeReportFixture();
  return {
    target: fixture.target,
    getCanonicalRevision: () => fixture.target.getSnapshot().revision,
    runSuccessfulCommand: () => fixture.target.setLayerOpacity(
      { surfaceId: 'lh', layerId: 'response' },
      0.42
    ),
    assertSuccessfulSnapshot: (snapshot: SurfViewControlSnapshot) => {
      expect(snapshot.surfaces.find(surface => surface.id === 'lh')?.layers
        .find(layer => layer.id === 'response')?.opacity).toBe(0.42);
    },
    runInvalidCommand: () => fixture.target.setDisplayedLayer('missing'),
    runExternalMutation: () => fixture.leftResponse.setOpacity(0.73),
    disposeFixture: () => fixture.dispose()
  };
});

describe('ReportSceneControlTarget', () => {
  it('joins manifest presentation metadata without mutating live DataLayer presentation', () => {
    const fixture = makeReportFixture();
    try {
      const snapshot = fixture.target.getSnapshot();
      const left = snapshot.surfaces.find(surface => surface.id === 'lh');
      const response = left?.layers.find(layer => layer.id === 'response');

      expect(left?.metadata).toEqual({ subject: 'template', surface: 'pial' });
      expect(response).toMatchObject({
        label: 'Language response',
        units: 'z',
        metadata: {
          contrast: 'language-control',
          provenance: { pipeline: 'report-builder', version: 2 },
          legend: {
            title: 'Language response',
            units: 'z',
            visible: true,
            metadata: { ticks: [-3, 0, 5] }
          }
        }
      });
      expect(fixture.leftResponse.getPresentation()).toEqual({ label: 'response' });

      expect(fixture.target.setInspectionSelection({
        kind: 'vertex',
        surfaceId: 'lh',
        vertexIndex: 0
      })).toEqual({ ok: true });
      expect(fixture.target.getSnapshot().selection.inspection?.values
        .find(value => value.layerId === 'response')).toMatchObject({
        label: 'Language response',
        units: 'z',
        value: 1
      });
      expect(fixture.viewer.inspectVertex('lh', 0)?.values
        .find(value => value.layerId === 'response')).toEqual({
        layerId: 'response',
        label: 'response',
        value: 1,
        missing: false
      });
    } finally {
      fixture.dispose();
    }
  });

  it('exposes one exclusive map and applies it through all report surfaces', () => {
    const fixture = makeReportFixture();
    try {
      fixture.viewer.selectedLayerId = 'legacy-layer';
      expect(fixture.target.getSnapshot().capabilities.exclusiveMap).toEqual({
        availability: { enabled: true },
        displayedLayerId: 'response',
        availableLayerIds: ['response', 'uncertainty']
      });

      const notifications: SurfViewControlSnapshot[] = [];
      fixture.target.subscribe(snapshot => notifications.push(snapshot));
      notifications.length = 0;
      expect(fixture.target.setDisplayedLayer('uncertainty')).toEqual({ ok: true });
      expect(notifications).toHaveLength(1);
      expect(notifications[0].surfaces.every(surface =>
        surface.layers.find(layer => layer.id === 'response')?.visible === false &&
        surface.layers.find(layer => layer.id === 'uncertainty')?.visible === true
      )).toBe(true);
      expect(fixture.target.getSnapshot().capabilities.exclusiveMap?.displayedLayerId)
        .toBe('uncertainty');
      for (const surface of fixture.target.getSnapshot().surfaces) {
        expect(surface.layers.find(layer => layer.id === 'response')?.visible).toBe(false);
        expect(surface.layers.find(layer => layer.id === 'uncertainty')?.visible).toBe(true);
      }
      expect(fixture.viewer.selectedLayerId).toBe('legacy-layer');
    } finally {
      fixture.dispose();
    }
  });

  it('reports only the coordinated report target for anatomical views', () => {
    const fixture = makeReportFixture();
    try {
      expect(fixture.target.getSnapshot().view.targets).toEqual([{
        target: { kind: 'group', groupId: 'cortex' },
        label: 'Cortex Report Pair',
        availability: { enabled: true }
      }]);
      expect(fixture.target.setAnatomicalView({
        view: 'dorsal',
        target: { kind: 'group', groupId: 'cortex' }
      })).toEqual({ ok: true });
      expect(fixture.target.getSnapshot().view.current).toEqual({
        view: 'dorsal',
        target: { kind: 'group', groupId: 'cortex' }
      });
    } finally {
      fixture.dispose();
    }
  });

  it('returns typed unsupported failures for commands that violate report policy', () => {
    const fixture = makeReportFixture();
    try {
      expect(fixture.target.setLayerVisibility(
        { surfaceId: 'lh', layerId: 'response' },
        false
      )).toMatchObject({ ok: false, code: 'unsupported' });
      expect(fixture.target.setLayerOrder('lh', ['uncertainty', 'response']))
        .toMatchObject({ ok: false, code: 'unsupported' });
      expect(fixture.target.setDisplayedLayer('unknown'))
        .toMatchObject({ ok: false, code: 'layer-not-found' });
    } finally {
      fixture.dispose();
    }
  });

  it('observes external layer mutations and reconciles exclusive-map state', () => {
    const fixture = makeReportFixture();
    try {
      const listener = vi.fn();
      fixture.target.subscribe(listener);
      listener.mockClear();

      fixture.leftUncertainty.setVisible(true);
      expect(fixture.target.getSnapshot().capabilities.exclusiveMap?.displayedLayerId)
        .toBeNull();
      expect(listener).toHaveBeenCalled();

      fixture.leftResponse.setOpacity(0.35);
      expect(fixture.target.getSnapshot().surfaces
        .find(surface => surface.id === 'lh')?.layers
        .find(layer => layer.id === 'response')?.opacity).toBe(0.35);
    } finally {
      fixture.dispose();
    }
  });

  it('coalesces direct public controller commands into one consistent snapshot', () => {
    const fixture = makeReportFixture();
    try {
      const notifications: SurfViewControlSnapshot[] = [];
      fixture.target.subscribe(snapshot => notifications.push(snapshot));
      notifications.length = 0;

      expect(fixture.controller.setDisplayedLayer('uncertainty')).toEqual({ ok: true });

      expect(notifications).toHaveLength(1);
      expect(notifications[0].capabilities.exclusiveMap?.displayedLayerId)
        .toBe('uncertainty');
      expect(notifications[0].surfaces.every(surface =>
        surface.layers.find(layer => layer.id === 'response')?.visible === false &&
        surface.layers.find(layer => layer.id === 'uncertainty')?.visible === true
      )).toBe(true);
    } finally {
      fixture.dispose();
    }
  });

  it('eagerly closes subscriptions when its viewer is externally disposed', () => {
    const fixture = makeReportFixture();
    const subscription = fixture.target.subscribe(vi.fn());
    try {
      (fixture.viewer as any).initializationFailed = true;
      fixture.viewer.dispose();

      expect(subscription.closed).toBe(true);
      expect(fixture.target.setDisplayedLayer('uncertainty')).toMatchObject({
        ok: false,
        code: 'disposed'
      });
    } finally {
      fixture.dispose();
    }
  });
});
