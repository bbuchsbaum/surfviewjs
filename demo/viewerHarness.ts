import { NeuroSurfaceViewer } from '@src/index.js';
import type { NeuroSurfaceViewerConfig } from '@src/NeuroSurfaceViewer';

export interface ViewerHandle {
  viewer: NeuroSurfaceViewer;
  cleanup: () => void;
}

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
      showControls: true,
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
