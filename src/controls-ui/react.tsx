import React, {
  forwardRef,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef
} from 'react';
import type {
  ForwardedRef,
  HTMLAttributes,
  MutableRefObject,
  ReactElement,
  Ref
} from 'react';
import type { NeuroSurfaceViewer } from '../index';
import {
  mountSurfViewControls
} from './index';
import type {
  SurfViewControlsDensity,
  SurfViewControlsFeatureOptions,
  SurfViewControlsHandle,
  SurfViewControlsOptions,
  SurfViewControlsTheme
} from './index';

const useClientLayoutEffect = typeof globalThis.document === 'undefined'
  ? useEffect
  : useLayoutEffect;

type LifecycleStepsResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly error: unknown };

function runLifecycleSteps(steps: readonly (() => void)[]): LifecycleStepsResult {
  let failed = false;
  let firstError: unknown;
  for (const step of steps) {
    try {
      step();
    } catch (error) {
      if (!failed) {
        failed = true;
        firstError = error;
      }
    }
  }
  return failed ? { ok: false, error: firstError } : { ok: true };
}

export interface SurfViewControlsReactProps extends Omit<
  HTMLAttributes<HTMLDivElement>,
  'children'
> {
  /** Live viewer to control. Null renders an empty host without mounting. */
  readonly viewer: NeuroSurfaceViewer | null;
  /** Optional application-owned mount container. The component renders no host when supplied. */
  readonly container?: HTMLElement | null;
  /** Ref to the internally rendered host; null while using an external container. */
  readonly containerRef?: Ref<HTMLDivElement>;
  readonly label?: string;
  readonly theme?: SurfViewControlsTheme;
  readonly density?: SurfViewControlsDensity;
  readonly features?: SurfViewControlsFeatureOptions;
  /** Mount identity options; memoize these objects when supplied. */
  readonly target?: SurfViewControlsOptions['target'];
  /** Initial session-local state; changing this object remounts only the panel session. */
  readonly session?: SurfViewControlsOptions['session'];
  /** Stable PluginHost id. Changing it remounts only the panel session. */
  readonly pluginId?: string;
  readonly onMount?: (handle: SurfViewControlsHandle) => void;
  readonly onDispose?: (handle: SurfViewControlsHandle) => void;
  readonly onMountError?: (error: unknown) => void;
}

function assignRef<T>(ref: Ref<T> | ForwardedRef<T> | undefined, value: T | null): void {
  if (typeof ref === 'function') {
    ref(value);
  } else if (ref) {
    (ref as MutableRefObject<T | null>).current = value;
  }
}

/**
 * Thin React owner for the first-party custom element.
 *
 * Theme, density, label, and feature changes update the mounted element in
 * place. Viewer, external-container, target, session, or plugin-id changes
 * replace only the control-panel mount; they never recreate the viewer.
 */
export const SurfViewControls = forwardRef<
  SurfViewControlsHandle,
  SurfViewControlsReactProps
>(function SurfViewControls({
  viewer,
  container = null,
  containerRef,
  label = 'SurfView controls',
  theme = 'auto',
  density = 'comfortable',
  features,
  target,
  session,
  pluginId,
  onMount,
  onDispose,
  onMountError,
  ...hostProps
}, forwardedRef): ReactElement | null {
  const internalContainerRef = useRef<HTMLDivElement | null>(null);
  const mountedHandleRef = useRef<SurfViewControlsHandle | null>(null);
  const forwardedRefRef = useRef(forwardedRef);
  const onMountRef = useRef(onMount);
  const onDisposeRef = useRef(onDispose);
  const onMountErrorRef = useRef(onMountError);
  onMountRef.current = onMount;
  onDisposeRef.current = onDispose;
  onMountErrorRef.current = onMountError;

  const reportLifecycleError = (error: unknown): void => {
    if (onMountErrorRef.current) {
      onMountErrorRef.current(error);
      return;
    }
    throw error;
  };

  const setInternalContainer = useCallback((node: HTMLDivElement | null) => {
    internalContainerRef.current = node;
    assignRef(containerRef, node);
  }, [containerRef]);

  useClientLayoutEffect(() => {
    const previous = forwardedRefRef.current;
    if (previous === forwardedRef) return;
    forwardedRefRef.current = forwardedRef;
    const result = runLifecycleSteps([
      () => assignRef(previous, null),
      () => assignRef(forwardedRef, mountedHandleRef.current)
    ]);
    if (!result.ok) reportLifecycleError(result.error);
  }, [forwardedRef]);

  useClientLayoutEffect(() => {
    if (!viewer) {
      const result = runLifecycleSteps([
        () => assignRef(forwardedRefRef.current, null)
      ]);
      if (!result.ok) reportLifecycleError(result.error);
      return;
    }
    const host = container ?? internalContainerRef.current;
    if (!host) return;

    let handle: SurfViewControlsHandle;
    try {
      handle = mountSurfViewControls(viewer, host, {
        label,
        theme,
        density,
        features,
        target,
        session,
        pluginId
      });
    } catch (error) {
      reportLifecycleError(error);
      return;
    }

    mountedHandleRef.current = handle;
    let released = false;
    let unsubscribeViewerDisposing = (): void => {};
    const release = (): LifecycleStepsResult => {
      if (released) return { ok: true };
      released = true;
      if (mountedHandleRef.current === handle) {
        mountedHandleRef.current = null;
      }
      return runLifecycleSteps([
        () => unsubscribeViewerDisposing(),
        () => assignRef(forwardedRefRef.current, null),
        () => handle.dispose(),
        () => onDisposeRef.current?.(handle)
      ]);
    };

    try {
      unsubscribeViewerDisposing = viewer.on('viewer:disposing', () => {
        const result = release();
        if (!result.ok) reportLifecycleError(result.error);
      });
    } catch (error) {
      const cleanup = release();
      reportLifecycleError(error);
      if (!cleanup.ok) reportLifecycleError(cleanup.error);
      return;
    }

    const setup = runLifecycleSteps([
      () => assignRef(forwardedRefRef.current, handle),
      () => onMountRef.current?.(handle)
    ]);
    if (!setup.ok) {
      const cleanup = release();
      reportLifecycleError(setup.error);
      if (!cleanup.ok) reportLifecycleError(cleanup.error);
      return;
    }

    return () => {
      const result = release();
      if (!result.ok) {
        reportLifecycleError(result.error);
      }
    };
  }, [viewer, container, target, session, pluginId]);

  useClientLayoutEffect(() => {
    const element = mountedHandleRef.current?.element;
    if (!element) return;
    element.controlLabel = label.trim() || 'SurfView controls';
    element.theme = theme;
    element.density = density;
    element.features = features ?? {};
  }, [label, theme, density, features]);

  if (container) return null;
  return <div {...hostProps} ref={setInternalContainer} />;
});

SurfViewControls.displayName = 'SurfViewControls';

export type { SurfViewControlsHandle } from './index';
