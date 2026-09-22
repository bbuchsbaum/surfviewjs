import React, { createRef } from 'react';
import {
  NeuroSurfaceViewerReact,
  SurfaceHelpers,
  useNeuroSurface
} from '../../src/index.react';
import type {
  BackendLayerUpdate,
  NeuroSurfaceViewerHandle,
  NeuroSurfaceViewerReactProps,
  UseNeuroSurfaceResult
} from '../../src/index.react';

const viewerRef = createRef<NeuroSurfaceViewerHandle>();
const onReady: NeuroSurfaceViewerReactProps['onReady'] = viewer => {
  viewer.setViewpoint('medial');
};
const component = (
  <NeuroSurfaceViewerReact
    ref={viewerRef}
    width={0}
    height={0}
    viewpoint="lateral"
    onReady={onReady}
    onSurfaceClick={event => void event.vertexIndex}
    onError={error => void error.message}
  />
);
void component;

const hook: UseNeuroSurfaceResult = useNeuroSurface(viewerRef, {
  onError(error) {
    void error.message;
  }
});
hook.addSurface({
  type: 'multi-layer',
  vertices: new Float32Array(),
  faces: new Uint32Array(),
  hemisphere: ''
}, 'lh');
hook.addLayer('lh', {
  type: 'rgba',
  id: '',
  rgbaData: new Float32Array(),
  config: { opacity: 0, visible: false }
});
const backendUpdate = {
  id: 'activation',
  type: 'rgba',
  rgbaData: new Float32Array(),
  opacity: 0,
  visible: false
} satisfies BackendLayerUpdate;
hook.updateLayersFromBackend('lh', [backendUpdate]);
hook.updateLayer('lh', 'activation', { opacity: 0, visible: false, label: '' });

const geometry = SurfaceHelpers.createGeometry(
  new Float32Array(),
  new Uint32Array(),
  ''
);
SurfaceHelpers.createMultiLayerSurface(geometry, { useGPUCompositing: false });

// @ts-expect-error width is measured in numeric CSS pixels.
<NeuroSurfaceViewerReact width="800" />;
// @ts-expect-error the public ref exposes viewer operations, not a div.
<NeuroSurfaceViewerReact ref={createRef<HTMLDivElement>()} />;
// @ts-expect-error a color-mapped surface requires its colormap.
hook.addSurface({
  type: 'color-mapped',
  vertices: [],
  faces: [],
  data: []
});
// @ts-expect-error visibility is boolean, not a numeric sentinel.
hook.updateLayersFromBackend('lh', [{ id: 'x', visible: 0 }]);
// @ts-expect-error layer opacity is numeric, not boolean.
hook.updateLayer('lh', 'x', { opacity: false });
