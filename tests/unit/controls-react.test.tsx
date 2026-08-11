/**
 * @vitest-environment jsdom
 */
import React, { StrictMode, createRef } from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  EventEmitter,
  getStylePreset,
  NeuroSurfaceViewer
} from '../../src';
import type { ViewerEventMap } from '../../src/events';
import { PluginHost } from '../../src/PluginHost';
import {
  SurfViewControls
} from '../../src/controls-ui/react';
import type { SurfViewControlsHandle } from '../../src/controls-ui';

function makeViewer(): NeuroSurfaceViewer {
  const viewer = new EventEmitter<ViewerEventMap>() as any;
  Object.setPrototypeOf(viewer, NeuroSurfaceViewer.prototype);
  viewer.disposed = false;
  viewer.initializationFailed = true;
  viewer.stateRevision = 3;
  viewer.pendingStateDomains = new Set();
  viewer.inspectionSelection = Object.freeze({ kind: 'none' });
  viewer.currentAnatomicalView = null;
  viewer.bilateralSurfaceGroups = new Map();
  viewer.surfaceGroupMembership = new Map();
  viewer.container = document.createElement('div');
  viewer.camera = { id: 'camera-sentinel' };
  viewer.scene = { children: [] };
  viewer.surfaces = new Map();
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

async function render(root: Root, node: React.ReactNode): Promise<void> {
  await act(async () => {
    root.render(node);
  });
}

async function unmount(root: Root): Promise<void> {
  await act(async () => {
    root.unmount();
  });
}

beforeEach(() => {
  vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

describe('React controls adapter', () => {
  it('updates live presentation props and features without remounting', async () => {
    const viewer = makeViewer();
    const reactHost = document.createElement('div');
    document.body.appendChild(reactHost);
    const root = createRoot(reactHost);
    const controlsRef = createRef<SurfViewControlsHandle>();
    const containerRef = createRef<HTMLDivElement>();
    const onMount = vi.fn();
    const onDispose = vi.fn();
    let didUnmount = false;

    try {
      await render(root, (
        <SurfViewControls
          ref={controlsRef}
          containerRef={containerRef}
          viewer={viewer}
          label="Initial controls"
          theme="dark"
          density="comfortable"
          features={{ include: ['view', 'figure'] }}
          data-testid="react-controls-host"
          onMount={onMount}
          onDispose={onDispose}
        />
      ));
      const first = controlsRef.current!;
      await first.element.updateComplete;

      expect(first).toBeDefined();
      expect(containerRef.current?.dataset.testid).toBe('react-controls-host');
      expect(onMount).toHaveBeenCalledTimes(1);
      expect(onDispose).not.toHaveBeenCalled();
      expect(first.element.getAttribute('theme')).toBe('dark');
      expect(first.element.shadowRoot?.querySelector('.view-section')).not.toBeNull();
      expect(first.element.shadowRoot?.querySelector('.layers-section')).toBeNull();
      expect(first.element.shadowRoot?.querySelector('.figure-section')).not.toBeNull();
      expect(first.element.shadowRoot?.querySelector('dialog')).not.toBeNull();

      await render(root, (
        <SurfViewControls
          ref={controlsRef}
          containerRef={containerRef}
          viewer={viewer}
          label="Updated controls"
          theme="light"
          density="compact"
          features={{ include: ['layers', 'selection'] }}
          data-testid="react-controls-host"
          onMount={onMount}
          onDispose={onDispose}
        />
      ));
      await first.element.updateComplete;

      expect(controlsRef.current).toBe(first);
      expect(onMount).toHaveBeenCalledTimes(1);
      expect(onDispose).not.toHaveBeenCalled();
      expect(first.element.controlLabel).toBe('Updated controls');
      expect(first.element.getAttribute('theme')).toBe('light');
      expect(first.element.getAttribute('density')).toBe('compact');
      expect(first.element.shadowRoot?.querySelector('.view-section')).toBeNull();
      expect(first.element.shadowRoot?.querySelector('.layers-section')).not.toBeNull();
      expect(first.element.shadowRoot?.querySelector('.selection-section')).not.toBeNull();
      expect(first.element.shadowRoot?.querySelector('.figure-section')).toBeNull();
      expect(first.element.shadowRoot?.querySelector('dialog')).toBeNull();

      await unmount(root);
      didUnmount = true;
      expect(first.disposed).toBe(true);
      expect(onDispose).toHaveBeenCalledTimes(1);
      expect(controlsRef.current).toBeNull();
      expect(viewer.listPlugins()).toEqual([]);
    } finally {
      if (!didUnmount) await unmount(root);
      viewer.dispose();
    }
  });

  it('moves deterministically between viewers and an application-owned container', async () => {
    const firstViewer = makeViewer();
    const secondViewer = makeViewer();
    const reactHost = document.createElement('div');
    const externalHost = document.createElement('aside');
    document.body.append(reactHost, externalHost);
    const root = createRoot(reactHost);
    const controlsRef = createRef<SurfViewControlsHandle>();
    const mounted: SurfViewControlsHandle[] = [];
    const disposed: SurfViewControlsHandle[] = [];
    let didUnmount = false;

    try {
      await render(root, (
        <SurfViewControls
          ref={controlsRef}
          viewer={firstViewer}
          container={externalHost}
          pluginId="react-controls"
          onMount={handle => mounted.push(handle)}
          onDispose={handle => disposed.push(handle)}
        />
      ));
      const first = controlsRef.current!;
      expect(reactHost.children).toHaveLength(0);
      expect(externalHost.firstElementChild).toBe(first.element);
      expect(firstViewer.listPlugins()).toHaveLength(1);

      await render(root, (
        <SurfViewControls
          ref={controlsRef}
          viewer={secondViewer}
          container={externalHost}
          pluginId="react-controls"
          onMount={handle => mounted.push(handle)}
          onDispose={handle => disposed.push(handle)}
        />
      ));
      const second = controlsRef.current!;

      expect(second).not.toBe(first);
      expect(first.disposed).toBe(true);
      expect(firstViewer.listPlugins()).toEqual([]);
      expect(secondViewer.listPlugins()).toHaveLength(1);
      expect(externalHost.children).toHaveLength(1);
      expect(externalHost.firstElementChild).toBe(second.element);

      await unmount(root);
      didUnmount = true;
      expect(second.disposed).toBe(true);
      expect(secondViewer.listPlugins()).toEqual([]);
      expect(externalHost.children).toHaveLength(0);
      expect(disposed).toEqual(mounted);
    } finally {
      if (!didUnmount) await unmount(root);
      firstViewer.dispose();
      secondViewer.dispose();
    }
  });

  it('leaves one live panel in StrictMode and disposes every acquired handle once', async () => {
    const viewer = makeViewer();
    const reactHost = document.createElement('div');
    document.body.appendChild(reactHost);
    const root = createRoot(reactHost);
    const mounted: SurfViewControlsHandle[] = [];
    const disposed: SurfViewControlsHandle[] = [];
    let didUnmount = false;

    try {
      await render(root, (
        <StrictMode>
          <SurfViewControls
            viewer={viewer}
            onMount={handle => mounted.push(handle)}
            onDispose={handle => disposed.push(handle)}
          />
        </StrictMode>
      ));

      expect(mounted.length).toBeGreaterThanOrEqual(2);
      expect(disposed).toHaveLength(mounted.length - 1);
      expect(viewer.listPlugins()).toHaveLength(1);
      expect(reactHost.querySelectorAll('surfview-controls')).toHaveLength(1);
      expect(mounted.filter(handle => !handle.disposed)).toHaveLength(1);

      await unmount(root);
      didUnmount = true;
      expect(disposed).toEqual(mounted);
      expect(new Set(disposed).size).toBe(disposed.length);
      expect(disposed.every(handle => handle.disposed)).toBe(true);
      expect(viewer.listPlugins()).toEqual([]);
      expect(reactHost.querySelectorAll('surfview-controls')).toHaveLength(0);
    } finally {
      if (!didUnmount) await unmount(root);
      viewer.dispose();
    }
  });

  it('reports mount lifecycle failures after releasing a partially acquired handle', async () => {
    const viewer = makeViewer();
    const reactHost = document.createElement('div');
    document.body.appendChild(reactHost);
    const root = createRoot(reactHost);
    const controlsRef = createRef<SurfViewControlsHandle>();
    const onDispose = vi.fn();
    const onMountError = vi.fn();
    let acquired: SurfViewControlsHandle | null = null;
    let didUnmount = false;

    try {
      await render(root, (
        <SurfViewControls
          ref={controlsRef}
          viewer={viewer}
          onMount={handle => {
            acquired = handle;
            throw new Error('host lifecycle failure');
          }}
          onDispose={onDispose}
          onMountError={onMountError}
        />
      ));

      expect(acquired).not.toBeNull();
      expect((acquired as unknown as SurfViewControlsHandle).disposed).toBe(true);
      expect(onDispose).toHaveBeenCalledExactlyOnceWith(acquired);
      expect(onMountError).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ message: 'host lifecycle failure' })
      );
      expect(controlsRef.current).toBeNull();
      expect(viewer.listPlugins()).toEqual([]);
      expect(reactHost.querySelectorAll('surfview-controls')).toHaveLength(0);

      await unmount(root);
      didUnmount = true;
      expect(onDispose).toHaveBeenCalledTimes(1);
    } finally {
      if (!didUnmount) await unmount(root);
      viewer.dispose();
    }
  });

  it('cannot leak when a forwarded ref throws while receiving the handle', async () => {
    const viewer = makeViewer();
    const reactHost = document.createElement('div');
    document.body.appendChild(reactHost);
    const root = createRoot(reactHost);
    const onDispose = vi.fn();
    const onMountError = vi.fn();
    let acquired: SurfViewControlsHandle | null = null;
    let didUnmount = false;
    const hostileRef = (handle: SurfViewControlsHandle | null) => {
      if (handle) throw new Error('hostile handle assignment');
    };

    try {
      await render(root, (
        <SurfViewControls
          ref={hostileRef}
          viewer={viewer}
          onMount={handle => { acquired = handle; }}
          onDispose={onDispose}
          onMountError={onMountError}
        />
      ));

      expect(acquired).not.toBeNull();
      expect((acquired as unknown as SurfViewControlsHandle).disposed).toBe(true);
      expect(onDispose).toHaveBeenCalledExactlyOnceWith(acquired);
      expect(onMountError).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ message: 'hostile handle assignment' })
      );
      expect(viewer.listPlugins()).toEqual([]);
      expect(reactHost.querySelectorAll('surfview-controls')).toHaveLength(0);

      await unmount(root);
      didUnmount = true;
      expect(onDispose).toHaveBeenCalledTimes(1);
    } finally {
      if (!didUnmount) await unmount(root);
      viewer.dispose();
    }
  });

  it('disposes before reporting a forwarded ref that throws on cleanup', async () => {
    const viewer = makeViewer();
    const reactHost = document.createElement('div');
    document.body.appendChild(reactHost);
    const root = createRoot(reactHost);
    const onDispose = vi.fn();
    const onMountError = vi.fn();
    let assigned: SurfViewControlsHandle | null = null;
    const hostileRef = (handle: SurfViewControlsHandle | null) => {
      if (!handle) throw new Error('hostile handle clearing');
      assigned = handle;
    };

    await render(root, (
      <SurfViewControls
        ref={hostileRef}
        viewer={viewer}
        onDispose={onDispose}
        onMountError={onMountError}
      />
    ));
    expect(assigned).not.toBeNull();
    expect(viewer.listPlugins()).toHaveLength(1);

    await unmount(root);
    expect((assigned as unknown as SurfViewControlsHandle).disposed).toBe(true);
    expect(onDispose).toHaveBeenCalledExactlyOnceWith(assigned);
    expect(onMountError).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ message: 'hostile handle clearing' })
    );
    expect(viewer.listPlugins()).toEqual([]);
    expect(reactHost.querySelectorAll('surfview-controls')).toHaveLength(0);
    viewer.dispose();
  });

  it('synchronizes refs and disposal callbacks when the viewer disposes first', async () => {
    const viewer = makeViewer();
    const reactHost = document.createElement('div');
    document.body.appendChild(reactHost);
    const root = createRoot(reactHost);
    const controlsRef = createRef<SurfViewControlsHandle>();
    const onDispose = vi.fn();
    let didUnmount = false;

    try {
      await render(root, (
        <SurfViewControls
          ref={controlsRef}
          viewer={viewer}
          onDispose={onDispose}
        />
      ));
      const handle = controlsRef.current!;

      await act(async () => viewer.dispose());
      expect(handle.disposed).toBe(true);
      expect(controlsRef.current).toBeNull();
      expect(onDispose).toHaveBeenCalledExactlyOnceWith(handle);
      expect(viewer.listPlugins()).toEqual([]);
      expect(reactHost.querySelectorAll('surfview-controls')).toHaveLength(0);

      await unmount(root);
      didUnmount = true;
      expect(onDispose).toHaveBeenCalledTimes(1);
    } finally {
      if (!didUnmount) await unmount(root);
      viewer.dispose();
    }
  });
});
