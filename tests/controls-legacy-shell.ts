import { NeuroSurfaceViewer } from '@src/index.js';
import type { NeuroSurfaceViewerConfig } from '@src/NeuroSurfaceViewer';

/**
 * Test-only host for the controls QA fixtures. It reproduces the pre-redesign
 * demo shell (navigation column, top bar, viewer frame, side panel) that the
 * controls golden snapshots were recorded in, so the component region renders
 * at the same width, position and inherited typography.
 */
export interface LegacyShellContext {
  mount: HTMLElement;
  panel: HTMLElement;
  status: (message: string) => void;
  perf: (message: string) => void;
  setBusy: (busy: boolean, label?: string) => void;
}

export function legacyShell(title: string, description: string): LegacyShellContext {
  document.getElementById('active-title')!.textContent = title;
  document.getElementById('active-desc')!.textContent = description;
  const viewerSlot = document.getElementById('viewer-slot')!;
  const panel = document.getElementById('panel')!;
  const viewerFrame = document.getElementById('viewer-frame')!;
  const statusEl = document.getElementById('status-text')!;
  const perfEl = document.getElementById('perf-text')!;

  const mount = document.createElement('div');
  mount.className = 'scenario-mount';
  const panelHost = document.createElement('div');
  panelHost.className = 'scenario-panel';
  viewerSlot.replaceChildren(mount);
  panel.replaceChildren(panelHost);

  return {
    mount,
    panel: panelHost,
    status: message => { statusEl.textContent = message; },
    perf: message => { perfEl.textContent = message; },
    setBusy: (busy, label) => {
      viewerFrame.classList.toggle('busy', busy);
      viewerFrame.setAttribute('aria-busy', String(busy));
      if (label) statusEl.textContent = label;
    }
  };
}

export interface ViewerHandle {
  viewer: NeuroSurfaceViewer;
  cleanup: () => void;
}

/** The pre-redesign demo viewer harness (dark background, window-resize following). */
export function createViewer(
  mount: HTMLElement,
  config: Partial<NeuroSurfaceViewerConfig> & { viewpoint?: string } = {}
): ViewerHandle {
  const width = mount.clientWidth || mount.parentElement?.clientWidth || 960;
  const height = mount.clientHeight || mount.parentElement?.clientHeight || 640;

  const viewer = new NeuroSurfaceViewer(
    mount,
    width,
    height,
    {
      backgroundColor: 0x050912,
      ambientLightColor: 0x404040,
      ...config
    },
    config.viewpoint || 'lateral'
  );

  viewer.startRenderLoop();

  const handleResize = () => {
    viewer.resize(mount.clientWidth, mount.clientHeight);
  };
  window.addEventListener('resize', handleResize);

  const cleanup = () => {
    window.removeEventListener('resize', handleResize);
    viewer.dispose();
  };

  return { viewer, cleanup };
}
