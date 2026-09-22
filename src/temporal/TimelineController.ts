import { EventEmitter } from '../EventEmitter';
import type { TimelineState, TimelineEvent, TimelineEventMap, LoopMode } from './types';
import { finiteNumber } from '../utils/validation';

const LOOP_MODES: readonly LoopMode[] = ['none', 'loop', 'bounce'];

function validateLoopMode(mode: unknown): LoopMode {
  if (!LOOP_MODES.includes(mode as LoopMode)) {
    throw new TypeError(`loop mode must be one of ${LOOP_MODES.join(', ')}.`);
  }
  return mode as LoopMode;
}

/**
 * Playback state machine for temporal data.
 *
 * Emits `'timechange'` events with `{ time, frameA, frameB, alpha }` on each
 * animation frame. Knows nothing about layers or rendering — it is a pure
 * time-source driven entirely by `requestAnimationFrame`.
 */
export class TimelineController extends EventEmitter<TimelineEventMap> {
  private times: number[];
  private readonly minTime: number;
  private readonly maxTime: number;
  private currentTime: number;
  private playing: boolean;
  private speed: number;
  private loopMode: LoopMode;
  private direction: 1 | -1; // for bounce mode
  private rafId: number | null;
  private lastTimestamp: number;
  private disposed: boolean;

  constructor(
    times: number[],
    options: { speed?: number; loop?: LoopMode; autoPlay?: boolean } = {}
  ) {
    super();

    if (!times || times.length === 0) {
      throw new Error('TimelineController requires a non-empty times array');
    }

    this.times = times.map((time, index) => finiteNumber(time, `times[${index}]`));
    for (let index = 1; index < this.times.length; index += 1) {
      if (this.times[index]! < this.times[index - 1]!) {
        throw new RangeError('times must be sorted in ascending order.');
      }
    }
    // The non-empty check above proves both endpoints are present.
    this.minTime = this.times[0]!;
    this.maxTime = this.times[this.times.length - 1]!;
    this.currentTime = this.minTime;
    this.playing = false;
    this.speed = finiteNumber(options.speed ?? 1, 'speed', {
      minimum: 0,
      minimumExclusive: true
    });
    this.loopMode = validateLoopMode(options.loop ?? 'loop');
    this.direction = 1;
    this.rafId = null;
    this.lastTimestamp = 0;
    this.disposed = false;

    if (options.autoPlay) {
      this.play();
    }
  }

  play(): void {
    if (this.disposed || this.playing) return;
    this.playing = true;
    this.lastTimestamp = 0;
    this.scheduleFrame();
    this.emit('play');
  }

  pause(): void {
    if (!this.playing) return;
    this.playing = false;
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    this.emit('pause');
  }

  stop(): void {
    this.pause();
    this.currentTime = this.minTime;
    this.direction = 1;
    this.emitTimeChange();
    this.emit('stop');
  }

  toggle(): void {
    if (this.playing) {
      this.pause();
    } else {
      this.play();
    }
  }

  seek(time: number): void {
    const requestedTime = finiteNumber(time, 'time');
    this.currentTime = Math.max(this.minTime, Math.min(this.maxTime, requestedTime));
    this.emitTimeChange();
  }

  setSpeed(multiplier: number): void {
    const speed = finiteNumber(multiplier, 'speed', {
      minimum: 0,
      minimumExclusive: true
    });
    if (speed === this.speed) return;
    this.speed = speed;
    this.emit('speedchange', { speed });
  }

  setLoop(mode: LoopMode): void {
    const nextMode = validateLoopMode(mode);
    if (nextMode === this.loopMode) return;
    this.loopMode = nextMode;
    if (nextMode !== 'bounce') {
      this.direction = 1;
    }
    this.emit('loopchange', { loopMode: nextMode });
  }

  getState(): TimelineState {
    const { frameA, frameB, alpha } = this.resolveFrame(this.currentTime);
    return {
      currentTime: this.currentTime,
      playing: this.playing,
      speed: this.speed,
      loopMode: this.loopMode,
      frameA,
      frameB,
      alpha
    };
  }

  /**
   * Binary-search the times array to find bracketing frame indices + alpha.
   */
  private resolveFrame(time: number): { frameA: number; frameB: number; alpha: number } {
    const T = this.times.length;

    if (T === 1) {
      return { frameA: 0, frameB: 0, alpha: 0 };
    }

    if (time <= this.minTime) {
      return { frameA: 0, frameB: 0, alpha: 0 };
    }
    if (time >= this.maxTime) {
      return { frameA: T - 1, frameB: T - 1, alpha: 0 };
    }

    // Binary search for the interval
    let lo = 0;
    let hi = T - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >>> 1;
      if (this.times[mid]! <= time) {
        lo = mid;
      } else {
        hi = mid;
      }
    }

    // Binary-search bounds stay inside this non-empty array.
    const tA = this.times[lo]!;
    const tB = this.times[hi]!;
    const span = tB - tA;
    const alpha = span > 0 ? (time - tA) / span : 0;

    // If alpha is effectively 0, snap frameB to frameA
    if (alpha < 1e-10) {
      return { frameA: lo, frameB: lo, alpha: 0 };
    }

    return { frameA: lo, frameB: hi, alpha };
  }

  private tick(timestamp: number): void {
    this.rafId = null;
    if (this.disposed || !this.playing) return;

    if (this.lastTimestamp === 0) {
      this.lastTimestamp = timestamp;
    }

    const dtMs = timestamp - this.lastTimestamp;
    this.lastTimestamp = timestamp;

    // Convert speed to time-units per second.
    // "1x" plays through the entire time range in (range / 1) seconds.
    const range = this.maxTime - this.minTime;
    if (range <= 0) {
      this.scheduleFrame();
      return;
    }

    const dtTime = (dtMs / 1000) * this.speed * range * this.direction;
    this.currentTime += dtTime;

    const minT = this.minTime;
    const maxT = this.maxTime;

    // Handle boundaries
    if (this.currentTime > maxT) {
      switch (this.loopMode) {
        case 'loop':
          this.currentTime = minT + (this.currentTime - maxT);
          break;
        case 'bounce':
          this.currentTime = maxT - (this.currentTime - maxT);
          this.direction = -1;
          break;
        case 'none':
          this.currentTime = maxT;
          this.pause();
          break;
      }
    } else if (this.currentTime < minT) {
      switch (this.loopMode) {
        case 'loop':
          this.currentTime = maxT - (minT - this.currentTime);
          break;
        case 'bounce':
          this.currentTime = minT + (minT - this.currentTime);
          this.direction = 1;
          break;
        case 'none':
          this.currentTime = minT;
          this.pause();
          break;
      }
    }

    this.emitTimeChange();

    if (this.playing) {
      this.scheduleFrame();
    }
  }

  private readonly onAnimationFrame = (timestamp: number): void => {
    this.tick(timestamp);
  };

  private scheduleFrame(): void {
    if (this.disposed || !this.playing || this.rafId !== null) return;
    this.rafId = requestAnimationFrame(this.onAnimationFrame);
  }

  private emitTimeChange(): void {
    const { frameA, frameB, alpha } = this.resolveFrame(this.currentTime);
    const event: TimelineEvent = {
      time: this.currentTime,
      frameA,
      frameB,
      alpha
    };
    this.emit('timechange', event);
  }

  toStateJSON(): { currentTime: number; speed: number; loopMode: string; playing: boolean } {
    return {
      currentTime: this.currentTime,
      speed: this.speed,
      loopMode: this.loopMode,
      playing: this.playing
    };
  }

  fromStateJSON(state: { currentTime?: number; speed?: number; loopMode?: string; playing?: boolean }): void {
    const currentTime = state.currentTime === undefined
      ? undefined
      : finiteNumber(state.currentTime, 'currentTime');
    const speed = state.speed === undefined
      ? undefined
      : finiteNumber(state.speed, 'speed', { minimum: 0, minimumExclusive: true });
    const loopMode = state.loopMode === undefined
      ? undefined
      : validateLoopMode(state.loopMode);
    if (currentTime !== undefined) this.seek(currentTime);
    if (speed !== undefined) this.setSpeed(speed);
    if (loopMode !== undefined) this.setLoop(loopMode);
    if (state.playing === true) this.play();
    else if (state.playing === false) this.pause();
  }

  dispose(): void {
    if (this.disposed) return;
    this.pause();
    this.disposed = true;
    this.removeAllListeners();
  }
}
