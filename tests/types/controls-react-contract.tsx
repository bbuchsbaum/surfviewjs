import React, { createRef } from 'react';
import type { NeuroSurfaceViewer } from '../../src';
import type { SurfViewControlsHandle } from '../../src/controls-ui';
import {
  SurfViewControls
} from '../../src/controls-ui/react';
import type {
  SurfViewControlsReactProps
} from '../../src/controls-ui/react';

declare const viewer: NeuroSurfaceViewer;
declare const container: HTMLElement;

const handleRef = createRef<SurfViewControlsHandle>();
const props = {
  viewer,
  container,
  label: 'Cortical controls',
  theme: 'auto',
  density: 'compact',
  features: {
    include: ['view', 'layers', 'layer-inspector', 'selection', 'figure']
  },
  target: { histogramBins: 64 },
  session: { focusedSurfaceId: 'lh', focusedLayerId: 'activation' },
  pluginId: 'react-controls',
  onMount(handle) {
    handle.session.getSnapshot();
  },
  onDispose(handle) {
    void handle.disposed;
  },
  onMountError(error) {
    void error;
  }
} satisfies SurfViewControlsReactProps;

const controls = <SurfViewControls ref={handleRef} {...props} />;
void controls;

const internal = (
  <SurfViewControls
    viewer={viewer}
    containerRef={createRef<HTMLDivElement>()}
    className="controls-host"
    aria-label="Controls host"
  />
);
void internal;

// @ts-expect-error viewer is required
<SurfViewControls theme="dark" />;
// @ts-expect-error features use the documented workflow vocabulary
<SurfViewControls viewer={viewer} features={{ include: ['gpu-diagnostics'] }} />;
// @ts-expect-error the forwarded ref exposes a controls handle, not a viewer
<SurfViewControls ref={createRef<NeuroSurfaceViewer>()} viewer={viewer} />;
// @ts-expect-error theme is a closed vocabulary
<SurfViewControls viewer={viewer} theme="sepia" />;
