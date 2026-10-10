import type { NeuroSurfaceViewer } from '@src/index.js';
import { mountSurfViewControls } from '@src/controls-ui/index.js';

// The viewer already holds surfaces 'lh' and 'rh', each with a 'contrast' layer.
export function addControls(viewer: NeuroSurfaceViewer, host: HTMLElement) {
  const controls = mountSurfViewControls(viewer, host, {
    label: 'Cortical scene controls',
    theme: 'dark',
    density: 'comfortable',
    features: { include: ['view', 'layers', 'layer-inspector', 'selection', 'figure'] },
    session: { focusedSurfaceId: 'lh', focusedLayerId: 'contrast' }
  });

  // Theme through CSS custom properties on the element (or a stylesheet rule).
  controls.element.style.setProperty('--surfview-controls-radius', '0');
  controls.element.style.setProperty('--surfview-controls-focus', '#f2c230');

  // Narrow the panel to one task at any time.
  const showTask = (task: 'view' | 'layers') => {
    controls.element.features = { include: task === 'view' ? ['view'] : ['layers', 'layer-inspector'] };
  };
  return { showTask, dispose: () => controls.dispose() };
}
