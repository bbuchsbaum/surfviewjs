import { afterEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from '../../src/EventEmitter';
import { MultiLayerNeuroSurface } from '../../src/MultiLayerNeuroSurface';
import { NeuroSurfaceViewer } from '../../src/NeuroSurfaceViewer';
import type { ViewerEventMap } from '../../src/events';

function makeViewer(): NeuroSurfaceViewer {
  const emitter = new EventEmitter<ViewerEventMap>();
  Object.setPrototypeOf(emitter, NeuroSurfaceViewer.prototype);
  const viewer = emitter as unknown as NeuroSurfaceViewer;
  const cameraControls = {
    enabled: true,
    target: { set: vi.fn(), copy: vi.fn(), toArray: vi.fn(() => [0, 0, 0]) },
    update: vi.fn(),
    dispose: vi.fn()
  };

  Object.assign(viewer as any, {
    cameraControls,
    cameraInteractionEnabled: true,
    config: {
      showControls: false,
      useControls: false,
      allowCDNFallback: false
    },
    surfaces: new Map(),
    selectedSurfaceId: null,
    selectedLayerId: null,
    rimStrengthUniforms: [],
    requestRender: vi.fn()
  });
  return viewer;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('pane-era compatibility', () => {
  it('keeps pane methods as warning no-ops without hidden state mutation', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const viewer = makeViewer();
    const configBefore = { ...viewer.config };

    expect(viewer.getControlsVisible()).toBe(false);
    viewer.toggleControls(true);
    viewer.togglePaneMinimized();
    viewer.minimizeControlsPane();
    viewer.restoreControlsPane();
    viewer.updateIntensityRange();
    viewer.updateThresholdRange();
    viewer.updateDataRange(new Float32Array([-10, 10]));

    const firstWarnings = warn.mock.calls.map(([message]) => String(message));
    expect(firstWarnings).toHaveLength(8);
    expect(firstWarnings).toEqual(expect.arrayContaining([
      expect.stringContaining('getControlsVisible()'),
      expect.stringContaining('toggleControls()'),
      expect.stringContaining('togglePaneMinimized()'),
      expect.stringContaining('minimizeControlsPane()'),
      expect.stringContaining('restoreControlsPane()'),
      expect.stringContaining('updateIntensityRange()'),
      expect.stringContaining('updateThresholdRange()'),
      expect.stringContaining('updateDataRange()')
    ]));

    viewer.toggleControls(false);
    viewer.minimizeControlsPane();
    viewer.updateIntensityRange();
    expect(warn).toHaveBeenCalledTimes(8);
    expect(viewer.config).toEqual(configBefore);
    expect(viewer.requestRender).not.toHaveBeenCalled();
  });

  it('normalizes enabled legacy config updates to false and warns once', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const viewer = makeViewer();

    viewer.updateConfig({
      showControls: true,
      useControls: true,
      allowCDNFallback: true
    });
    viewer.updateConfig({ showControls: true });

    expect(viewer.config.showControls).toBe(false);
    expect(viewer.config.useControls).toBe(false);
    expect(viewer.config.allowCDNFallback).toBe(false);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain('showControls/useControls/allowCDNFallback');
  });

  it('keeps updateColormap functional only as a deprecated compatibility helper', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const viewer = makeViewer();
    const layer = { id: 'activation', setColorMap: vi.fn() };
    const surface = Object.create(MultiLayerNeuroSurface.prototype) as MultiLayerNeuroSurface;
    Object.assign(surface, {
      layerStack: { getAllLayers: () => [layer] },
      updateLayer: vi.fn((_id: string, updates: { colorMap: string }) => {
        layer.setColorMap(updates.colorMap);
      })
    });
    viewer.surfaces.set('lh', surface);
    viewer.selectedSurfaceId = 'lh';
    viewer.selectedLayerId = 'activation';
    const changed = vi.fn();
    viewer.on('layer:colormap', changed);

    viewer.updateColormap('hot');
    viewer.updateColormap('viridis');

    expect(layer.setColorMap).toHaveBeenNthCalledWith(1, 'hot');
    expect(layer.setColorMap).toHaveBeenNthCalledWith(2, 'viridis');
    expect(changed).toHaveBeenNthCalledWith(1, {
      surfaceId: 'lh',
      layerId: 'activation',
      colormap: 'hot'
    });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain('updateColormap()');
  });
});

describe('camera interaction naming', () => {
  it('uses cameraControls canonically while retaining controls as a 2.x alias', () => {
    const viewer = makeViewer();

    expect(viewer.controls).toBe(viewer.cameraControls);
    const replacement = { ...viewer.cameraControls, enabled: true };
    viewer.controls = replacement as typeof viewer.cameraControls;
    expect(viewer.cameraControls).toBe(replacement);
  });

  it('sets interaction explicitly and keeps deprecated method aliases functional', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const viewer = makeViewer();
    const changed = vi.fn();
    viewer.on('controls:changed', changed);

    viewer.setInteractionEnabled(false);
    expect(viewer.isInteractionEnabled()).toBe(false);
    expect(viewer.cameraControls.enabled).toBe(false);
    expect(changed).toHaveBeenLastCalledWith({ enabled: false });

    viewer.setInteractionEnabled(false);
    expect(changed).toHaveBeenCalledTimes(1);

    viewer.enableControls();
    viewer.disableControls();
    viewer.enableControls();

    expect(viewer.isInteractionEnabled()).toBe(true);
    expect(viewer.cameraControls.enabled).toBe(true);
    expect(changed).toHaveBeenCalledTimes(4);
    expect(warn).toHaveBeenCalledTimes(2);
    expect(warn.mock.calls.map(([message]) => String(message))).toEqual(expect.arrayContaining([
      expect.stringContaining('enableControls()'),
      expect.stringContaining('disableControls()')
    ]));
  });
});
