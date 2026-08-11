/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import {
  EventEmitter,
  getStylePreset,
  NeuroSurfaceViewer
} from '../../src';
import type { ViewerEventMap } from '../../src/events';
import { PluginHost } from '../../src/PluginHost';
import {
  defineSurfViewControlsElement,
  mountSurfViewControls,
  SURFVIEW_CONTROLS_TAG,
  SurfViewControlsElement
} from '../../src/controls-ui';

beforeEach(() => {
  vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

function makeViewer(): NeuroSurfaceViewer {
  const viewer = new EventEmitter<ViewerEventMap>() as any;
  Object.setPrototypeOf(viewer, NeuroSurfaceViewer.prototype);
  viewer.disposed = false;
  viewer.initializationFailed = true;
  viewer.stateRevision = 17;
  viewer.pendingStateDomains = new Set();
  viewer.inspectionSelection = Object.freeze({ kind: 'none' });
  viewer.currentAnatomicalView = null;
  viewer.bilateralSurfaceGroups = new Map();
  viewer.surfaceGroupMembership = new Map();
  viewer.container = document.createElement('div');
  viewer.camera = { id: 'camera-sentinel' };
  viewer.scene = { children: [{ id: 'scene-sentinel' }] };
  viewer.surfaces = new Map([
    ['sentinel', {
      hemisphere: 'left',
      layers: [{ id: 'layer-sentinel' }]
    }]
  ]);
  viewer.config = {
    preset: 'default',
    backgroundColor: 0x102030,
    useShaders: false
  };
  viewer.stylePreset = getStylePreset('default');
  viewer.requestRender = vi.fn();
  viewer.plugins = new PluginHost(viewer);
  document.body.appendChild(viewer.container);
  return viewer;
}

describe('SurfView controls element shell', () => {
  it('registers explicitly and idempotently', () => {
    defineSurfViewControlsElement();
    defineSurfViewControlsElement();

    expect(customElements.get(SURFVIEW_CONTROLS_TAG)).toBe(
      SurfViewControlsElement
    );
  });

  it('mounts inline without mutating viewer state or application layout', async () => {
    const viewer = makeViewer();
    const sidebar = document.createElement('aside');
    document.body.appendChild(sidebar);
    const camera = viewer.camera;
    const scene = viewer.scene;
    const sceneChildren = [...viewer.scene.children];
    const surfaces = viewer.surfaces;
    const surfaceEntries = [...viewer.surfaces.entries()];
    const config = { ...viewer.config };
    const revision = viewer.getStateRevision();

    const handle = mountSurfViewControls(viewer, sidebar, {
      label: 'Cortical surface controls',
      theme: 'dark',
      density: 'compact'
    });
    await handle.element.updateComplete;

    expect(sidebar.children).toHaveLength(1);
    expect(sidebar.firstElementChild).toBe(handle.element);
    expect(viewer.container.parentElement).toBe(document.body);
    expect(viewer.camera).toBe(camera);
    expect(viewer.scene).toBe(scene);
    expect(viewer.scene.children).toEqual(sceneChildren);
    expect(viewer.surfaces).toBe(surfaces);
    expect([...viewer.surfaces.entries()]).toEqual(surfaceEntries);
    expect(viewer.config).toEqual(config);
    expect(viewer.getStateRevision()).toBe(revision);
    expect(viewer.requestRender).not.toHaveBeenCalled();
    expect(requestAnimationFrame).not.toHaveBeenCalled();
    expect(handle.element.shadowRoot?.querySelector('[role="region"]')
      ?.getAttribute('aria-label')).toBe('Cortical surface controls');
    expect(handle.element.shadowRoot?.textContent).toContain('SurfView');
    expect(handle.element.snapshot).toBe(handle.session.getSnapshot());
    expect(handle.element.theme).toBe('dark');
    expect(handle.element.density).toBe('compact');
    expect(handle.element.getAttribute('theme')).toBe('dark');
    expect(handle.element.getAttribute('density')).toBe('compact');

    handle.dispose();
    viewer.dispose();
  });

  it('shares canonical state across mounts while keeping local sessions distinct', () => {
    const viewer = makeViewer();
    const firstHost = document.createElement('aside');
    const secondHost = document.createElement('aside');
    document.body.append(firstHost, secondHost);

    const first = mountSurfViewControls(viewer, firstHost, {
      session: { advancedVisible: true }
    });
    const second = mountSurfViewControls(viewer, secondHost);

    expect(first.session).not.toBe(second.session);
    expect(first.session.getSnapshot().canonical)
      .toBe(second.session.getSnapshot().canonical);
    expect(first.session.getSnapshot().state.advancedVisible).toBe(true);
    expect(second.session.getSnapshot().state.advancedVisible).toBe(false);

    first.dispose();
    expect(second.session.isDisposed()).toBe(false);
    second.dispose();
    viewer.dispose();
  });

  it('rejects foreign-realm containers before acquiring a plugin or session', () => {
    const viewer = makeViewer();
    const foreignDom = new JSDOM('<aside id="controls"></aside>');
    const foreignHost = foreignDom.window.document.querySelector('aside');

    try {
      expect(() => mountSurfViewControls(
        viewer,
        foreignHost as unknown as HTMLElement
      )).toThrow(/same DOM realm/);
      expect(viewer.listPlugins()).toEqual([]);
      expect(foreignHost?.children).toHaveLength(0);
    } finally {
      foreignDom.window.close();
      viewer.dispose();
    }
  });

  it('disposes idempotently and removes element, session, and plugin registration', () => {
    const viewer = makeViewer();
    const sidebar = document.createElement('aside');
    document.body.appendChild(sidebar);
    const handle = mountSurfViewControls(viewer, sidebar);

    expect(viewer.getPlugin(handle.pluginId)).not.toBeNull();
    handle.dispose();
    handle.dispose();

    expect(handle.disposed).toBe(true);
    expect(handle.session.isDisposed()).toBe(true);
    expect(handle.element.isConnected).toBe(false);
    expect(sidebar.children).toHaveLength(0);
    expect(viewer.getPlugin(handle.pluginId)).toBeNull();
    viewer.dispose();
  });

  it('viewer disposal tears down mounted controls exactly once', async () => {
    const viewer = makeViewer();
    const sidebar = document.createElement('aside');
    document.body.appendChild(sidebar);
    const handle = mountSurfViewControls(viewer, sidebar);
    const subscription = handle.session.subscribe(vi.fn());
    handle.session.setAdvancedVisible(true);

    viewer.dispose();
    viewer.dispose();
    handle.dispose();
    await new Promise<void>(resolve => queueMicrotask(resolve));

    expect(handle.disposed).toBe(true);
    expect(handle.session.isDisposed()).toBe(true);
    expect(subscription.closed).toBe(true);
    expect(handle.element.isConnected).toBe(false);
    expect(sidebar.children).toHaveLength(0);
    expect(viewer.listPlugins()).toEqual([]);
    expect(cancelAnimationFrame).not.toHaveBeenCalled();
  });

  it('releases every resource when element disposal throws', () => {
    const viewer = makeViewer();
    const sidebar = document.createElement('aside');
    document.body.appendChild(sidebar);
    const handle = mountSurfViewControls(viewer, sidebar);
    handle.element.dispose = vi.fn(() => {
      throw new Error('hostile element teardown');
    });

    expect(() => handle.dispose()).toThrow(/hostile element teardown/);
    expect(handle.disposed).toBe(true);
    expect(handle.session.isDisposed()).toBe(true);
    expect(handle.element.session).toBeNull();
    expect(handle.element.isConnected).toBe(false);
    expect(sidebar.children).toHaveLength(0);
    expect(viewer.getPlugin(handle.pluginId)).toBeNull();
    expect(() => handle.dispose()).not.toThrow();
    viewer.dispose();
  });
});
