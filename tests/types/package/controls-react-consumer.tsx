import React, { createRef } from 'react';
import type { NeuroSurfaceViewer } from 'surfview';
import {
  defineSurfViewControlsElement,
  SurfViewControlsElement
} from 'surfview/controls';
import type {
  SurfViewControlsElementConstructor
} from 'surfview/controls';
import {
  SurfViewControls
} from 'surfview/controls/react';
import type {
  SurfViewControlsHandle,
  SurfViewControlsReactProps
} from 'surfview/controls/react';

declare const viewer: NeuroSurfaceViewer;
declare const container: HTMLElement;

const elementConstructor: SurfViewControlsElementConstructor =
  defineSurfViewControlsElement();
const element: SurfViewControlsElement = new elementConstructor();
const updateComplete: Promise<boolean> = element.updateComplete;
void elementConstructor.styles.toString();
void updateComplete;

const handleRef = createRef<SurfViewControlsHandle>();
const props = {
  viewer,
  container,
  density: 'compact',
  theme: 'dark',
  features: {
    include: ['view', 'layers', 'layer-inspector', 'selection', 'figure']
  },
  onMount(handle) {
    handle.session.getSnapshot();
  }
} satisfies SurfViewControlsReactProps;

const controls = <SurfViewControls ref={handleRef} {...props} />;
void controls;

// @ts-expect-error package consumers must provide a viewer.
<SurfViewControls density="compact" />;
// @ts-expect-error package consumers receive the closed scientific feature vocabulary.
<SurfViewControls viewer={viewer} features={{ include: ['gpu-diagnostics'] }} />;
// @ts-expect-error the package subpath ref exposes the controls handle, not the viewer.
<SurfViewControls ref={createRef<NeuroSurfaceViewer>()} viewer={viewer} />;
