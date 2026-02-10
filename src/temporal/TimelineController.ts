import { EventEmitter } from '../EventEmitter';
import type { TimelineState, TimelineEvent, LoopMode } from './types';

/**
 * Playback state machine for temporal data.
 *
 * Emits `'timechange'` events with `{ time, frameA, frameB, alpha }` on each
 * animation frame. Knows nothing about layers or rendering — it is a pure
 * time-source driven entirely by `requestAnimationFrame`.
 */
export class TimelineController extends EventEmitter {
  private times: number[];
  private currentTime: number;
  private playing: boolean;
  private speed: number;
  private loopMode: LoopMode;
  private direction: 1 | -1; // for bounce mode
  private rafId: number | null;
  private lastTimestamp: number;

  constructor(
    times: number[],
    options: { speed?: number; loop?: LoopMode; autoPlay?: boolean } = {}
  ) {
    super();

    if (!times || times.length === 0) {
      throw new Error('TimelineController requires a non-empty times array');
    }

    this.times = times.slice();
    this.currentTime = times[0];
    this.playing = false;
    this.speed = options.speed ?? 1;
    this.loopMode = options.loop ?? 'loop';
    this.direction = 1;
    this.rafId = null;
    this.lastTimestamp = 0;

    if (options.autoPlay) {
      this.play();
    }
  }

  play(): void {
    if (this.playing) return;
    this.playing = true;
    this.lastTimestamp = 0;
    this.rafId = requestAnimationFrame((ts) => this.tick(ts));
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
    this.currentTime = this.times[0];
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
    const minT = this.times[0];
    const maxT = this.times[this.times.length - 1];
    this.currentTime = Math.max(minT, Math.min(maxT, time));
    this.emitTimeChange();
  }

  setSpeed(multiplier: number): void {
    this.speed = Math.max(0.01, multiplier);
  }

  setLoop(mode: LoopMode): void {
    this.loopMode = mode;
    if (mode !== 'bounce') {
      this.direction = 1;
    }
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

    if (time <= this.times[0]) {
      return { frameA: 0, frameB: 0, alpha: 0 };
    }
    if (time >= this.times[T - 1]) {
      return { frameA: T - 1, frameB: T - 1, alpha: 0 };
    }

    // Binary search for the interval
    let lo = 0;
    let hi = T - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >>> 1;
      if (this.times[mid] <= time) {
        lo = mid;
      } else {
        hi = mid;
      }
    }

    const tA = this.times[lo];
    const tB = this.times[hi];
    const span = tB - tA;
    const alpha = span > 0 ? (time - tA) / span : 0;

    // If alpha is effectively 0, snap frameB to frameA
    if (alpha < 1e-10) {
      return { frameA: lo, frameB: lo, alpha: 0 };
    }

    return { frameA: lo, frameB: hi, alpha };
  }

  private tick(timestamp: number): void {
    if (!this.playing) return;

    if (this.lastTimestamp === 0) {
      this.lastTimestamp = timestamp;
    }

    const dtMs = timestamp - this.lastTimestamp;
    this.lastTimestamp = timestamp;

    // Convert speed to time-units per second.
    // "1x" plays through the entire time range in (range / 1) seconds.
    const range = this.times[this.times.length - 1] - this.times[0];
    if (range <= 0) {
      this.rafId = requestAnimationFrame((ts) => this.tick(ts));
      return;
    }

    const dtTime = (dtMs / 1000) * this.speed * range * this.direction;
    this.currentTime += dtTime;

    const minT = this.times[0];
    const maxT = this.times[this.times.length - 1];

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
      this.rafId = requestAnimationFrame((ts) => this.tick(ts));
    }
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
    if (state.currentTime !== undefined) this.seek(state.currentTime);
    if (state.speed !== undefined) this.setSpeed(state.speed);
    if (state.loopMode !== undefined) this.setLoop(state.loopMode as any);
    if (state.playing === true) this.play();
    else if (state.playing === false) this.pause();
  }

  dispose(): void {
    this.pause();
    this.removeAllListeners();
  }
}
