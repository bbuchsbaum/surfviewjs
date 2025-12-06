import { NeuroSurfaceViewer } from '@src/index.js';

export interface ViewerHandle {
  viewer: NeuroSurfaceViewer;
  cleanup: () => void;
}

export function createViewer(
  mount: HTMLElement,
  config: Record<string, unknown> = {}
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
    (config as { viewpoint?: string }).viewpoint || 'lateral'
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
