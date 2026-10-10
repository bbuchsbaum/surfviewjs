import type { FilmOverlay } from './kit/film';

export interface ScenarioRunContext {
  /** The film sheet's image area. Chapters render their viewer (or plate) here. */
  mount: HTMLElement;
  /** The margin's controls area. Build controls with demo/kit/controls. */
  panel: HTMLElement;
  /** Scan-style overlay printed on the film: corners and orientation letters. */
  film: FilmOverlay;
  /** Query parameters the chapter was opened with (e.g. `atlas`, `dataset`). */
  params: URLSearchParams;
  status: (message: string) => void;
  perf: (message: string) => void;
  setBusy: (busy: boolean, label?: string) => void;
}

export type ScenarioCleanup = (() => void | Promise<void>) | void;

/** Banks on the viewbox: surface capabilities, atlas tools, and data/figure workflows. */
export type ScenarioGroup = 'surfaces' | 'atlases' | 'workflows';

export interface Scenario {
  id: string;
  /** Full chapter title shown in the margin. */
  title: string;
  /** One or two words for the chapter strip. */
  short: string;
  /** One paragraph: what this chapter demonstrates and why it matters. */
  summary: string;
  group: ScenarioGroup;
  tags: string[];
  /** States plainly which data are synthetic, when any are. */
  synthetic?: string;
  /** Source of a short public-API excerpt (import it with `?raw` from demo/excerpts). */
  excerpt?: string;
  /** Older scenario ids that should open this chapter. */
  aliases?: string[];
  /** `wide` gives the film the full width (atlas tools with their own controls). */
  layout?: 'standard' | 'wide';
  run: (ctx: ScenarioRunContext) => ScenarioCleanup | Promise<ScenarioCleanup>;
}
