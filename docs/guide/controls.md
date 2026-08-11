# First-party controls

SurfView's optional control panel is a scientific workflow UI for a live
`NeuroSurfaceViewer`. It is ordinary DOM mounted beside the WebGL canvas. It
does not add objects to the Three.js scene, reset the camera, normalize layers,
or take ownership of application layout.

The panel is intentionally separate from the core package. Importing
`surfview` does not import Lit, register a custom element, inject panel CSS, or
touch the DOM. Importing `surfview/controls` is also safe in a DOM-less process:
registration occurs only when `defineSurfViewControlsElement()` or a mount
function is called in a browser realm.

## Prerequisites and live configurations

The controls ship in the same `surfview` package. Install SurfView and its
Three.js peer dependency, create a viewer, and add surfaces or layers before
mounting the panel:

```bash
npm install surfview three
```

The [interactive configuration gallery](https://bbuchsbaum.github.io/surfviewjs/demo/?scenario=controls-gallery)
shows the panel with dense and sparse data, one and many layers, light and dark
themes, compact and comfortable density, and narrow layouts. For a quieter
product view, open the [desktop layer workflow](https://bbuchsbaum.github.io/surfviewjs/demo/?scenario=controls-gallery&mode=product&task=layers)
or the [narrow view workflow](https://bbuchsbaum.github.io/surfviewjs/demo/?scenario=controls-gallery&mode=product&task=view).

## Canonical mounting API

Give the viewer and an explicit application-owned container to the mount
factory:

```ts
import { NeuroSurfaceViewer } from 'surfview';
import { mountSurfViewControls } from 'surfview/controls';

const viewerHost = document.querySelector<HTMLElement>('#viewer')!;
const controlsHost = document.querySelector<HTMLElement>('#controls')!;
const viewer = new NeuroSurfaceViewer(viewerHost, 900, 700);

const controls = mountSurfViewControls(viewer, controlsHost, {
  label: 'Cortical surface controls',
  theme: 'auto',
  density: 'comfortable',
  features: {
    include: ['view', 'layers', 'layer-inspector', 'selection', 'figure']
  },
  session: {
    focusedSurfaceId: 'lh',
    focusedLayerId: 'task-minus-rest'
  }
});

// Idempotently removes DOM, subscriptions, and the PluginHost registration.
controls.dispose();
```

The container determines where the panel appears. Use CSS Grid or Flexbox to
place it beside the canvas:

```css
.surfview-workspace {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(16rem, 22rem);
  gap: 1rem;
}

@media (max-width: 720px) {
  .surfview-workspace {
    grid-template-columns: 1fr;
  }
}
```

There is no implicit `dock` mode. Modal sheets, overlays, resizable sidebars,
and their focus-management policies belong to the host application.

`theme` accepts `auto`, `light`, or `dark`; `density` accepts `comfortable` or
`compact`. The panel inherits the host font and exposes CSS properties such as
`--surfview-controls-focus`, `--surfview-controls-background`, and
`--surfview-controls-radius` for restrained visual integration.

## Target state and session state

The UI depends on immutable descriptors, stable IDs, and typed commands:

```text
viewer or report controller
          |
   SurfViewControlTarget     canonical scientific and viewer state
          |
   SurfViewControlSession    one panel's focus and disclosure state
          |
   <surfview-controls>       rendering and native DOM interaction
```

A target owns observable canonical state: anatomical view, ordered surfaces and
layers, visibility, scalar mapping, scientific selection, and figure settings.
A session owns only presentation state such as the focused layer, expanded
sections, and symmetric-range lock. Two panels may therefore focus different
layers while both immediately converge on viewer mutations. Panel focus is not
serialized as scientific scene state.

Successful commands appear in the next immutable snapshot. Direct public
viewer mutations invalidate the same target descriptors, so synchronization is
bidirectional. Invalid commands return typed failures and do not mutate state.
The element never receives a Three.js camera, surface, concrete layer, live
`Map`, or raw vertex array.

## What v0.1 controls

The first release contains:

- the six supported anatomical views, Fit, and Reset;
- canonical layer order, visibility, focused-layer selection, opacity, and
  blend mode;
- a selected scalar-layer inspector with colormap, exact numeric display and
  mask ranges, native range inputs, symmetric lock, and a lazy histogram;
- scientific vertex or parcel inspection, including world coordinates, sparse
  layer values, atlas labels, and units when supplied;
- figure preset and background controls plus a keyboard-accessible PNG export
  dialog.

Layer reordering always has Move Up and Move Down buttons; dragging is not
required. Exact range values use native numeric inputs. Anatomical choices use
a native radio group. Visibility and active state are never conveyed by color
alone.

Capabilities absent from a descriptor are not rendered. V0.1 deliberately
does not expose temporal playback, bivariate mapping, surface variants or
morphing, clipping, parcel editing, connectivity, volume-projection internals,
lighting internals, compositor controls, SSAO tuning, FPS monitoring, or other
developer diagnostics. Those families can be added as separate capability
modules after their ownership and semantics are stable.

Use `features.include` to show a smaller subset of the five v0.1 workflow
sections. It changes presentation only; it does not disable viewer APIs.

## Direct custom-element integration

The factory is the supported default because it coordinates PluginHost and
lifecycle ownership. Advanced integrations can register the element explicitly
and supply a headless session:

```ts
import { createManagedViewerControlSession } from 'surfview';
import {
  defineSurfViewControlsElement,
  SurfViewControlsElement
} from 'surfview/controls';

defineSurfViewControlsElement();
const session = createManagedViewerControlSession(viewer);
const element = document.createElement('surfview-controls') as
  SurfViewControlsElement;
element.session = session;
element.theme = 'dark';
controlsHost.append(element);

// The advanced route owns both objects explicitly.
element.dispose();
session.dispose();
```

Do not call `customElements.define()` yourself. The exported definition helper
is idempotent and validates the active DOM realm.

## React

`surfview/controls/react` is a thin React 18 adapter over the same element:

```tsx
import { useState } from 'react';
import type { NeuroSurfaceViewer } from 'surfview';
import { SurfViewControls } from 'surfview/controls/react';

export function Sidebar() {
  const [viewer, setViewer] = useState<NeuroSurfaceViewer | null>(null);
  // Pass setViewer to the viewer component's onReady callback.
  return <SurfViewControls viewer={viewer} density="compact" />;
}
```

Changing label, theme, density, or features updates the live element. Changing
the viewer, container, target options, initial session options, or plugin ID
replaces only the panel mount. React StrictMode does not retain duplicate
panels or subscriptions. See [React integration](./react.md) for the viewer
component.

## Report scenes use a report target

Import report mounting from its explicit subpath:

```ts
import { createSurfViewControlSession } from 'surfview';
import { mountSurfView } from 'surfview/report';

const report = mountSurfView(reportHost, manifest, {
  controls: true,
  bilateralGroup: {
    id: 'cortex',
    leftSurfaceId: 'lh',
    rightSurfaceId: 'rh'
  }
});

await report.ready;
const session = createSurfViewControlSession(report.controlTarget!);
```

Do not create a normal viewer target from `report.viewer`. The report target
combines live layer state with manifest labels, units, legends, and provenance;
enforces the report's displayed-map policy; and coordinates paired mesh layout.
The compact report toolbar and a full panel should use separate sessions over
that target so local focus remains independent. See
[Portable report scenes](./portable-scenes.md) for full lifecycle details.

For 2.x compatibility, report symbols remain re-exported from `surfview`. The
`surfview/report` ESM artifact is a thin re-export of the sibling core bundle,
not a second runtime. Prefer the explicit subpath now; the root compatibility
re-exports are scheduled for removal in SurfView 3.

## Package boundaries

| Import | Purpose | Runtime boundary |
|---|---|---|
| `surfview` | Core viewer, targets, sessions, and 2.x report compatibility | No Lit, panel CSS, icons, element registration, or DOM access |
| `surfview/report` | Portable report runtime | Thin ESM re-export of core in 2.x |
| `surfview/controls` | Lit element and canonical mount factory | Optional ESM bundle; Lit is bundled, core is external |
| `surfview/controls/react` | React controls lifecycle adapter | React and the controls implementation are external |
| `surfview/react` | Existing React viewer bindings | React and core are external |

The root's internal temporal-layer factory registration is control-neutral; it
does not register DOM, fetch code, or mount UI. The package marks core, embed,
and the report re-export as side-effectful so bundlers preserve that required
factory registration; the controls and React entries remain import-observational.
No controls entry loads fonts, icons, styles, or other assets from a CDN.

## Pane-era and ViewerState migration

The former Tweakpane implementation has been deleted. In SurfView 2.x,
`showControls`, `useControls`, and `allowCDNFallback` are warning-only flags,
and pane visibility, minimize, and global range helpers are warning no-ops.
Use the factory above for UI. Use `viewer.cameraControls` and
`viewer.setInteractionEnabled()` for camera/surface interaction; the ambiguous
`controls`, `enableControls()`, and `disableControls()` aliases are deprecated.
These pane-era members and aliases are removed in SurfView 3. See the exact
[pane-era migration table](./viewer.md#pane-era-api-migration).

ViewerState v2 serializes canonical layer order, explicit bilateral groups, and
scientific inspection selection. It does not serialize session focus or
disclosure. SurfView 2.x deterministically accepts v1 state: layer `order` then
source position determines migrated order, pane-era `selectedSurfaceId` and
`selectedLayerId` are ignored, and only an explicitly visible selection-mode
crosshair becomes scientific selection. See
[State serialization](./viewer.md#state-serialization) for validation and
failure semantics.

## Runtime and packaging guarantees

The release gate is executable rather than inferred from a successful build.
The repository certifies:

- source and published-subpath type contracts;
- unit laws for two sessions, disposal, sparse inspection, canonical reorder
  round trips, report paired views, and next-animation-frame slider updates;
- desktop, narrow, empty, one-layer, many-layer, light, dark, compact, and
  comfortable visual states;
- keyboard operation, bidirectional viewer synchronization, and rendering with
  external network requests denied;
- DOM-less import boundaries, artifact externalization, and independent
  compressed-size budgets.

The production build enforces independent Brotli-compressed limits for each
public artifact:

| Artifact | Enforced limit |
|---|---:|
| Core ESM | 320 kB |
| Report ESM adapter | 2 kB |
| Controls ESM | 80 kB |
| Controls React adapter | 8 kB |

Core grew to support control-neutral domain behavior such as canonical views
and layer order, inspection, state invalidation, target/session protocols, and
ViewerState migration. Lit, panel templates and CSS, icons, and custom-element
code remain confined to the optional controls artifact.

Run the complete gates from the repository root:

```bash
npm run type-check
npm run test:types
npm test
npm run build
npm run docs:build
npm run test:react-fixture:build
npm run demo:build
npm run size
npx start-server-and-test dev:ci http://localhost:4173/tests/test-gifti.html \
  "npx playwright test tests/e2e/controls-panel.spec.ts tests/e2e/controls-react.spec.ts"
git diff --check
```

The build-time artifact audit rejects Lit or controls CSS in core, duplicated
core code in `surfview/report`, duplicate panel/Lit code in the React adapter,
unexpected custom-element registration, or a DOM-less import that cannot fail
safely on late registration.
