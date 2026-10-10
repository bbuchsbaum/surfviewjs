import type { DataLayerConfig } from '../layers';

/**
 * Describes a factorial/experimental design dimension.
 * Maps each timepoint to a factor level, enabling future trellis sparklines.
 */
export interface FactorDescriptor {
  name: string;
  levels: string[];
  /** Index into `levels` for each timepoint. Length must equal number of frames. */
  assignment: number[];
}

/**
 * Configuration for a TemporalDataLayer.
 *
 * Note: `times` is passed as a standalone constructor parameter,
 * not inside this config object.
 */
export interface TemporalDataConfig extends DataLayerConfig {
  /** Optional factorial design descriptor. */
  factor?: FactorDescriptor;
}

/**
 * Snapshot of the TimelineController state.
 */
export interface TimelineState {
  currentTime: number;
  playing: boolean;
  speed: number;
  loopMode: LoopMode;
  frameA: number;
  frameB: number;
  alpha: number;
}

/**
 * Payload emitted on each 'timechange' event.
 */
export interface TimelineEvent {
  time: number;
  frameA: number;
  frameB: number;
  alpha: number;
}

export interface TimelineEventMap {
  play: void;
  pause: void;
  stop: void;
  timechange: TimelineEvent;
  speedchange: { speed: number };
  loopchange: { loopMode: LoopMode };
}

export type LoopMode = 'none' | 'loop' | 'bounce';

/**
 * Options for the SparklineOverlay canvas.
 */
export interface SparklineOptions {
  width?: number;
  height?: number;
  lineColor?: string;
  bgColor?: string;
  timeMarkerColor?: string;
  padding?: number;
  /** Corner radius in CSS pixels of the canvas and its painted background. Default 4. */
  cornerRadius?: number;
  /** CSS `box-shadow` of the canvas; `'none'` removes it. Default `'0 2px 8px rgba(0,0,0,0.5)'`. */
  shadow?: string;
  /** Class name(s) added to the overlay canvas for application styling. Default none. */
  className?: string;
}
