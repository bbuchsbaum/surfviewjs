import { DataLayer } from '../layers';
import type { Color } from '../ColorMap';
import ColorMap from '../ColorMap';
import type { TemporalDataConfig, FactorDescriptor } from './types';

/**
 * A DataLayer whose scalar data varies over time.
 *
 * Stores T frames of V-length Float32Arrays. On each call to `setTime()`,
 * linearly interpolates between bracketing frames and writes the result
 * into `this.data` (inherited from DataLayer), then invalidates so that
 * the layer stack will re-composite.
 *
 * Design: CPU interpolation happens *before* colormapping, which produces
 * correct visual blending (interpolating RGBA after colormapping would
 * produce muddy blends).
 */
export class TemporalDataLayer extends DataLayer {
  private frames: Float32Array[];
  private times: number[];
  private factor: FactorDescriptor | null;
  private vertexCount: number;

  constructor(
    id: string,
    frames: Float32Array[],
    times: number[],
    colorMap: ColorMap | string | Color[],
    config: TemporalDataConfig
  ) {
    // Validate inputs
    if (!frames || frames.length === 0) {
      throw new Error('TemporalDataLayer requires at least one frame');
    }
    if (times.length !== frames.length) {
      throw new Error(
        `times.length (${times.length}) must equal frames.length (${frames.length})`
      );
    }

    const vCount = frames[0].length;
    for (let i = 1; i < frames.length; i++) {
      if (frames[i].length !== vCount) {
        throw new Error(
          `Frame ${i} has ${frames[i].length} vertices, expected ${vCount}`
        );
      }
    }

    // Validate times are sorted ascending
    for (let i = 1; i < times.length; i++) {
      if (times[i] < times[i - 1]) {
        throw new Error('times must be sorted in ascending order');
      }
    }

    // Validate factor descriptor if provided
    if (config.factor) {
      if (config.factor.assignment.length !== frames.length) {
        throw new Error(
          `factor.assignment.length (${config.factor.assignment.length}) must equal frames.length (${frames.length})`
        );
      }
    }

    // Initialize with the first frame's data
    const initialData = new Float32Array(frames[0]);

    super(id, initialData, null, colorMap, {
      range: config.range,
      threshold: config.threshold,
      visible: config.visible,
      opacity: config.opacity,
      blendMode: config.blendMode,
      order: config.order
    });

    this.frames = frames;
    this.times = times.slice(); // defensive copy
    this.factor = config.factor ?? null;
    this.vertexCount = vCount;
  }

  /**
   * Interpolate between two bracketing frames and update internal data.
   *
   * @param frameA - Index of the earlier frame
   * @param frameB - Index of the later frame
   * @param alpha  - Interpolation factor [0, 1] where 0 = frameA, 1 = frameB
   */
  setTime(frameA: number, frameB: number, alpha: number): void {
    const fa = this.frames[frameA];
    const fb = this.frames[frameB];

    if (!fa || !fb) return;

    // Write directly into the DataLayer's existing buffer.
    // This avoids: (a) scratch-buffer aliasing bugs, and
    // (b) the per-tick Uint32Array allocation that setData() causes.
    const target = this.getData();
    if (!target) return;

    const oneMinusAlpha = 1 - alpha;
    for (let v = 0; v < this.vertexCount; v++) {
      target[v] = fa[v] * oneMinusAlpha + fb[v] * alpha;
    }

    this.needsUpdate = true;
  }

  /**
   * Extract the time series for a single vertex across all frames.
   */
  getTimeSeries(vertexIndex: number): Float32Array {
    const T = this.frames.length;
    const series = new Float32Array(T);
    for (let t = 0; t < T; t++) {
      series[t] = this.frames[t][vertexIndex];
    }
    return series;
  }

  /**
   * Return a copy of the time values array.
   */
  getTimes(): number[] {
    return this.times.slice();
  }

  /**
   * Return the factor descriptor, or null if none was provided.
   */
  getFactorDescriptor(): FactorDescriptor | null {
    return this.factor;
  }

  /**
   * Return the number of temporal frames.
   */
  getFrameCount(): number {
    return this.frames.length;
  }

  /**
   * Return the number of vertices per frame.
   */
  getVertexCount(): number {
    return this.vertexCount;
  }

  dispose(): void {
    this.frames = [];
    super.dispose();
  }
}
