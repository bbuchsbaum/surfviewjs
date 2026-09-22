import { DataLayer } from '../layers';
import type { Color } from '../ColorMap';
import ColorMap from '../ColorMap';
import type { TemporalDataConfig, FactorDescriptor } from './types';
import { finiteNumber } from '../utils/validation';

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

    const firstFrame = frames[0];
    if (!(firstFrame instanceof Float32Array)) {
      throw new TypeError('Frame 0 must be a Float32Array');
    }
    const vCount = firstFrame.length;
    for (let i = 1; i < frames.length; i++) {
      const frame = frames[i];
      if (!(frame instanceof Float32Array)) {
        throw new TypeError(`Frame ${i} must be a Float32Array`);
      }
      if (frame.length !== vCount) {
        throw new Error(
          `Frame ${i} has ${frame.length} vertices, expected ${vCount}`
        );
      }
    }

    const normalizedTimes = times.map((time, index) => finiteNumber(time, `times[${index}]`));
    // Validate times are sorted ascending
    for (let i = 1; i < normalizedTimes.length; i++) {
      if (normalizedTimes[i]! < normalizedTimes[i - 1]!) {
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
      if (config.factor.levels.length === 0) {
        throw new RangeError('factor.levels must contain at least one level');
      }
      config.factor.assignment.forEach((level, index) => finiteNumber(
        level,
        `factor.assignment[${index}]`,
        { minimum: 0, maximum: config.factor!.levels.length - 1, integer: true }
      ));
    }

    // Initialize with the first frame's data
    const initialData = new Float32Array(firstFrame);

    super(id, initialData, null, colorMap, {
      ...(config.range === undefined ? {} : { range: config.range }),
      ...(config.threshold === undefined ? {} : { threshold: config.threshold }),
      ...(config.visible === undefined ? {} : { visible: config.visible }),
      ...(config.opacity === undefined ? {} : { opacity: config.opacity }),
      ...(config.blendMode === undefined ? {} : { blendMode: config.blendMode }),
      ...(config.order === undefined ? {} : { order: config.order }),
      ...(config.presentation === undefined ? {} : { presentation: config.presentation })
    });

    this.frames = frames.slice();
    this.times = normalizedTimes;
    this.factor = config.factor
      ? {
          name: config.factor.name,
          levels: [...config.factor.levels],
          assignment: [...config.factor.assignment]
        }
      : null;
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
    const normalizedFrameA = finiteNumber(frameA, 'frameA', {
      minimum: 0,
      maximum: this.frames.length - 1,
      integer: true
    });
    const normalizedFrameB = finiteNumber(frameB, 'frameB', {
      minimum: 0,
      maximum: this.frames.length - 1,
      integer: true
    });
    const normalizedAlpha = finiteNumber(alpha, 'alpha', { minimum: 0, maximum: 1 });
    // Validated integer frame indices prove both frames are present.
    const fa = this.frames[normalizedFrameA]!;
    const fb = this.frames[normalizedFrameB]!;

    // Write directly into the DataLayer's existing buffer.
    // This avoids: (a) scratch-buffer aliasing bugs, and
    // (b) the per-tick Uint32Array allocation that setData() causes.
    const target = this.getData();
    if (!target) return;

    const oneMinusAlpha = 1 - normalizedAlpha;
    for (let v = 0; v < this.vertexCount; v++) {
      target[v] = fa[v]! * oneMinusAlpha + fb[v]! * normalizedAlpha;
    }

    this._markDataChanged();
    this._notifyChange({
      data: true,
      timeline: {
        frameA: normalizedFrameA,
        frameB: normalizedFrameB,
        alpha: normalizedAlpha
      }
    });
  }

  /**
   * Extract the time series for a single vertex across all frames.
   */
  getTimeSeries(vertexIndex: number): Float32Array {
    const validVertexIndex = finiteNumber(vertexIndex, 'vertexIndex', {
      minimum: 0,
      maximum: this.vertexCount - 1,
      integer: true
    });
    const T = this.frames.length;
    const series = new Float32Array(T);
    for (let t = 0; t < T; t++) {
      // Frame shapes were validated once during construction.
      series[t] = this.frames[t]![validVertexIndex]!;
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
    return this.factor
      ? {
          name: this.factor.name,
          levels: [...this.factor.levels],
          assignment: [...this.factor.assignment]
        }
      : null;
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

  toStateJSON(): Record<string, unknown> {
    return {
      ...super.toStateJSON(),
      type: 'temporal',
      times: this.getTimes(),
      frameCount: this.getFrameCount(),
      factor: this.getFactorDescriptor()
    };
  }

  dispose(): void {
    this.frames = [];
    super.dispose();
  }
}
