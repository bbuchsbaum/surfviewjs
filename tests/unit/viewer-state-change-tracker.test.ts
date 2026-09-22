import { describe, expect, it, vi } from 'vitest';
import {
  controlDomainsForViewerEvent,
  ViewerStateChangeTracker
} from '../../src/viewer/ViewerStateChangeTracker';

describe('ViewerStateChangeTracker', () => {
  it('orders and coalesces nested state-domain batches into one revision', () => {
    const onChange = vi.fn();
    const tracker = new ViewerStateChangeTracker(onChange);

    tracker.runBatch(() => {
      tracker.invalidate(['timeline']);
      tracker.runBatch(() => tracker.invalidate(['camera', 'timeline']));
      tracker.invalidate(['layers']);
    });

    expect(onChange).toHaveBeenCalledOnce();
    expect(onChange).toHaveBeenCalledWith({
      revision: 1,
      domains: ['camera', 'layers', 'timeline']
    });
    expect(tracker.getRevision()).toBe(1);
  });

  it('flushes immediately outside a batch and becomes inert after disposal', () => {
    const onChange = vi.fn();
    const tracker = new ViewerStateChangeTracker(onChange);
    tracker.invalidate(['appearance']);
    tracker.dispose();
    tracker.invalidate(['camera']);

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(tracker.getRevision()).toBe(1);
  });

  it('maps event payloads to stable control domains', () => {
    expect(controlDomainsForViewerEvent('camera:changed', undefined)).toEqual(['camera']);
    expect(controlDomainsForViewerEvent('layer:updated', {
      surfaceId: 'surface',
      layerId: 'layer',
      changes: { timeline: { frame: 2 } }
    })).toEqual(['layers', 'timeline']);
    expect(controlDomainsForViewerEvent('anatomical-view:changed', {
      view: 'lateral',
      layout: 'paired',
      surfaceIds: ['left', 'right'],
      fit: true
    })).toEqual(['camera', 'surfaces']);
    expect(controlDomainsForViewerEvent('render:after', undefined)).toEqual([]);
  });
});
