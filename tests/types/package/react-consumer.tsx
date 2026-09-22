import React, { createRef } from 'react';
import {
  NeuroSurfaceViewerReact,
  useNeuroSurface
} from 'surfview/react';
import type {
  BackendLayerUpdate,
  NeuroSurfaceViewerHandle,
  NeuroSurfaceViewerReactProps,
  UseNeuroSurfaceResult
} from 'surfview/react';

const viewerRef = createRef<NeuroSurfaceViewerHandle>();
const props = {
  width: 0,
  height: 0,
  viewpoint: 'medial',
  onReady(viewer) {
    viewer.centerCamera();
  },
  onSurfaceClick(event) {
    void event.surfaceId;
  },
  onError(error) {
    void error.message;
  }
} satisfies NeuroSurfaceViewerReactProps;
const viewer = <NeuroSurfaceViewerReact ref={viewerRef} {...props} />;
void viewer;

const hook: UseNeuroSurfaceResult = useNeuroSurface(viewerRef);
hook.addSurface({
  type: 'multi-layer',
  vertices: new Float32Array(),
  faces: new Uint32Array(),
  hemisphere: ''
}, '');
hook.addLayer('', {
  type: 'data',
  id: '',
  data: new Float32Array(),
  indices: new Uint32Array(),
  colorMap: 'viridis',
  config: { opacity: 0, visible: false }
});
const update = {
  id: '',
  type: 'rgba',
  rgbaData: new Float32Array(),
  opacity: 0,
  visible: false
} satisfies BackendLayerUpdate;
hook.updateLayersFromBackend('', [update]);

// @ts-expect-error width must be numeric.
<NeuroSurfaceViewerReact width="0" />;
// @ts-expect-error ref exposes NeuroSurfaceViewerHandle.
<NeuroSurfaceViewerReact ref={createRef<HTMLCanvasElement>()} />;
// @ts-expect-error rgba layers require RGBA data.
hook.addLayer('lh', { type: 'rgba' });
// @ts-expect-error callbacks receive Error, not string.
<NeuroSurfaceViewerReact onError={(error: string) => void error} />;
