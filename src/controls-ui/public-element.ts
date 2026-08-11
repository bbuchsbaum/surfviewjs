import {
  defineSurfViewControlsElement as defineRuntimeElement,
  SURFVIEW_CONTROLS_TAG as RUNTIME_TAG,
  SurfViewControlsElement as RuntimeSurfViewControlsElement
} from './SurfViewControlsElement';
import type {
  SurfViewControlSession,
  SurfViewControlSessionSnapshot
} from '../index';
import type { SurfViewControlsFeatureOptions } from './features';

export const SURFVIEW_CONTROLS_TAG: 'surfview-controls' = RUNTIME_TAG;

export type SurfViewControlsTheme = 'auto' | 'light' | 'dark';
export type SurfViewControlsDensity = 'compact' | 'comfortable';

/**
 * Public, framework-neutral contract for the optional controls element.
 *
 * The implementation uses Lit internally, but package consumers interact with
 * an ordinary custom element and do not need Lit in their dependency graph.
 */
export interface SurfViewControlsElement extends HTMLElement {
  controlLabel: string;
  theme: SurfViewControlsTheme;
  density: SurfViewControlsDensity;
  features: SurfViewControlsFeatureOptions;
  session: SurfViewControlSession | null;
  readonly snapshot: SurfViewControlSessionSnapshot | null;
  readonly updateComplete: Promise<boolean>;
  /** Release element-local subscriptions without taking ownership of a session. */
  dispose(): void;
}

export interface SurfViewControlsElementConstructor {
  readonly prototype: SurfViewControlsElement;
  readonly styles: { toString(): string };
  new (): SurfViewControlsElement;
}

/** Runtime constructor with a public declaration that does not expose Lit. */
export const SurfViewControlsElement: SurfViewControlsElementConstructor =
  RuntimeSurfViewControlsElement as unknown as SurfViewControlsElementConstructor;

/** Register the element explicitly and idempotently. Importing does not call this. */
export function defineSurfViewControlsElement(): SurfViewControlsElementConstructor {
  return defineRuntimeElement() as unknown as SurfViewControlsElementConstructor;
}
