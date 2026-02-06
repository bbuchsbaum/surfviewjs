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
}
