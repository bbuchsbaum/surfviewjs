import React, { StrictMode, createRef } from 'react';
import { createRoot } from 'react-dom/client';
import {
  DataLayer,
  MultiLayerNeuroSurface,
  NeuroSurfaceViewer,
  SurfaceGeometry
} from '../../../src';
import type { SurfViewControlsHandle } from '../../../src/controls-ui';
import { SurfViewControls } from '../../../src/controls-ui/react';

const viewerHost = document.querySelector<HTMLElement>('#viewer');
const controlsHost = document.querySelector<HTMLElement>('#controls');
if (!viewerHost || !controlsHost) throw new Error('React controls fixture hosts are missing.');

const viewer = new NeuroSurfaceViewer(viewerHost, 720, 512, {
  backgroundColor: 0x0b1018,
  preset: 'presentation'
});
const geometry = new SurfaceGeometry(
  new Float32Array([
    -1, -1, 0,
    1, -1, 0,
    0, 1, 0,
    0, 0, 1.5
  ]),
  new Uint32Array([
    0, 1, 2,
    0, 3, 1,
    1, 3, 2,
    2, 3, 0
  ]),
  'left'
);
const surface = new MultiLayerNeuroSurface(geometry, { baseColor: 0xb8c0cc });
surface.hemisphere = 'left';
viewer.addSurface(surface, 'lh');
viewer.addLayer('lh', new DataLayer(
  'activation',
  new Float32Array([-2, -0.5, 1.25, 3]),
  null,
  'hot',
  {
    range: [-3, 3],
    opacity: 0.9,
    presentation: { label: 'Activation', units: 'z' }
  }
));
viewer.setAnatomicalView('lateral', {
  layout: 'single',
  surfaceId: 'lh',
  fit: true
});
viewer.startRenderLoop();

const controlsRef = createRef<SurfViewControlsHandle>();
const root = createRoot(controlsHost);
const mounted: SurfViewControlsHandle[] = [];
const disposed: SurfViewControlsHandle[] = [];

root.render(
  <StrictMode>
    <SurfViewControls
      ref={controlsRef}
      viewer={viewer}
      label="React cortical controls"
      theme="dark"
      density="compact"
      features={{
        include: ['view', 'layers', 'layer-inspector', 'selection', 'figure']
      }}
      onMount={handle => mounted.push(handle)}
      onDispose={handle => disposed.push(handle)}
    />
  </StrictMode>
);

declare global {
  interface Window {
    __surfviewReactControlsFixture: {
      readonly viewer: NeuroSurfaceViewer;
      readonly controlsRef: typeof controlsRef;
      readonly mounted: SurfViewControlsHandle[];
      readonly disposed: SurfViewControlsHandle[];
      unmount(): void;
      disposeViewer(): void;
    };
  }
}

window.__surfviewReactControlsFixture = {
  viewer,
  controlsRef,
  mounted,
  disposed,
  unmount() {
    root.unmount();
  },
  disposeViewer() {
    viewer.dispose();
  }
};
