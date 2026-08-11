import {
  createManagedViewerControlSession
} from '../index';
import type {
  ManagedViewerControlSessionOptions,
  NeuroSurfaceViewer,
  SurfViewControlSession
} from '../index';
import {
  defineSurfViewControlsElement,
  SURFVIEW_CONTROLS_TAG,
  SurfViewControlsElement
} from './public-element';
import type {
  SurfViewControlsDensity,
  SurfViewControlsTheme
} from './public-element';
import type { SurfViewControlsFeatureOptions } from './features';

export interface SurfViewControlsOptions extends ManagedViewerControlSessionOptions {
  /** Accessible name for this control surface. */
  readonly label?: string;
  /** Color treatment; auto follows the user's color-scheme preference. */
  readonly theme?: SurfViewControlsTheme;
  /** Permanent panel spacing. Export fields remain dialog-local in either density. */
  readonly density?: SurfViewControlsDensity;
  /** Optional workflow subset. Omitted means every first-party feature. */
  readonly features?: SurfViewControlsFeatureOptions;
  /** Optional stable PluginHost id. Duplicate ids are rejected, never replaced. */
  readonly pluginId?: string;
}

export interface SurfViewControlsHandle {
  readonly element: SurfViewControlsElement;
  readonly session: SurfViewControlSession;
  readonly pluginId: string;
  readonly disposed: boolean;
  /** Idempotently unmount the element and release this managed session owner. */
  dispose(): void;
}

let nextMountId = 1;

function allocatePluginId(viewer: NeuroSurfaceViewer): string {
  let id: string;
  do {
    id = `surfview-controls:${nextMountId}`;
    nextMountId += 1;
  } while (viewer.getPlugin(id));
  return id;
}

/**
 * Mount controls into an explicit application-owned container.
 *
 * Mounting observes current state but never normalizes the camera, surfaces,
 * layers, scene graph, or viewer configuration.
 */
export function mountSurfViewControls(
  viewer: NeuroSurfaceViewer,
  container: HTMLElement,
  options: SurfViewControlsOptions = {}
): SurfViewControlsHandle {
  if (!viewer || typeof viewer.registerPlugin !== 'function' || viewer.isDisposed()) {
    throw new Error('mountSurfViewControls requires a live NeuroSurfaceViewer.');
  }
  if (!container || typeof container.appendChild !== 'function' ||
      !container.ownerDocument) {
    throw new TypeError('mountSurfViewControls requires an explicit DOM container.');
  }

  const ownerWindow = container.ownerDocument.defaultView;
  if (!ownerWindow || ownerWindow !== globalThis.window ||
      !(SurfViewControlsElement.prototype instanceof ownerWindow.HTMLElement)) {
    throw new Error(
      'SurfView controls and their container must belong to the same DOM realm.'
    );
  }
  defineSurfViewControlsElement();

  const pluginId = options.pluginId?.trim() || allocatePluginId(viewer);
  let element: SurfViewControlsElement | null = null;
  let session: SurfViewControlSession | null = null;
  let elementReleased = false;
  let sessionReleased = false;
  let disposed = false;

  const cleanup = (): void => {
    if (disposed) return;
    let failure: unknown;
    let failed = false;
    const run = (step: () => void): void => {
      try {
        step();
      } catch (error) {
        if (!failed) {
          failed = true;
          failure = error;
        }
      }
    };

    if (!elementReleased) {
      run(() => element?.dispose());
      // A hostile override or partial element teardown must not retain the
      // session subscription or application-owned DOM node.
      run(() => {
        if (!element) return;
        element.session = null;
        element.remove();
      });
      elementReleased = !element ||
        (element.session === null && !element.isConnected);
    }
    if (!sessionReleased) {
      run(() => session?.dispose());
      sessionReleased = !session || session.isDisposed();
    }
    disposed = elementReleased && sessionReleased;
    if (failed) throw failure;
  };

  const registration = viewer.registerPlugin({
    id: pluginId,
    mount(host) {
      session = createManagedViewerControlSession(viewer, {
        target: options.target,
        session: options.session
      });
      try {
        element = host.ownerDocument.createElement(
          SURFVIEW_CONTROLS_TAG
        ) as SurfViewControlsElement;
        if (!(element instanceof SurfViewControlsElement)) {
          throw new Error(
            'The registered SurfView controls element is unavailable in this DOM realm.'
          );
        }
        element.controlLabel = options.label?.trim() || 'SurfView controls';
        element.theme = options.theme ?? 'auto';
        element.density = options.density ?? 'comfortable';
        element.features = options.features ?? {};
        element.session = session;
        host.appendChild(element);
      } catch (error) {
        cleanup();
        throw error;
      }
      return cleanup;
    }
  }, { container });

  if (!element || !session) {
    registration.dispose();
    throw new Error('SurfView controls did not complete synchronous mounting.');
  }

  const mountedElement = element;
  const mountedSession = session;
  return {
    element: mountedElement,
    session: mountedSession,
    pluginId,
    get disposed() {
      return disposed;
    },
    dispose() {
      if (disposed) return;
      registration.dispose();
    }
  };
}
