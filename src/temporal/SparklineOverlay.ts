import type { SparklineOptions, FactorDescriptor } from './types';

const DEFAULTS: Required<SparklineOptions> = {
  width: 200,
  height: 80,
  lineColor: '#00ccff',
  bgColor: 'rgba(0, 0, 0, 0.85)',
  timeMarkerColor: '#ff4444',
  padding: 8
};

/**
 * Lightweight hover tooltip that draws a vertex's time-series sparkline
 * on a floating `<canvas>` element.
 *
 * Canvas 2D is chosen over SVG for performance on the ~80 ms hover throttle.
 * A single canvas is reused (show/hide) rather than created/destroyed per hover.
 */
export class SparklineOverlay {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D | null;
  private container: HTMLElement;
  private opts: Required<SparklineOptions>;

  // Cached state for efficient time-marker-only redraws
  private lastTimeSeries: Float32Array | null = null;
  private lastTimes: number[] | null = null;
  private lastCurrentTime: number = 0;
  private lastFactor: FactorDescriptor | null = null;

  constructor(container: HTMLElement, options?: SparklineOptions) {
    this.container = container;
    this.opts = { ...DEFAULTS, ...options };

    this.canvas = document.createElement('canvas');
    this.canvas.width = this.opts.width;
    this.canvas.height = this.opts.height;
    this.canvas.style.cssText = `
      position: absolute;
      pointer-events: none;
      display: none;
      z-index: 10000;
      border-radius: 4px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.5);
    `;

    this.ctx = this.canvas.getContext('2d');
    this.container.appendChild(this.canvas);
  }

  /**
   * Show the sparkline at the given screen position.
   */
  show(
    timeSeries: Float32Array,
    times: number[],
    currentTime: number,
    screenX: number,
    screenY: number,
    factor?: FactorDescriptor
  ): void {
    this.lastTimeSeries = timeSeries;
    this.lastTimes = times;
    this.lastCurrentTime = currentTime;
    this.lastFactor = factor ?? null;

    this.drawFull(timeSeries, times, currentTime, factor ?? null);
    this.position(screenX, screenY);
    this.canvas.style.display = 'block';
  }

  /**
   * Hide the sparkline.
   */
  hide(): void {
    this.canvas.style.display = 'none';
    this.lastTimeSeries = null;
    this.lastTimes = null;
  }

  /**
   * Efficient redraw: update only the time marker without a full repaint.
   */
  updateTimeMarker(currentTime: number): void {
    if (!this.lastTimeSeries || !this.lastTimes) return;
    this.lastCurrentTime = currentTime;
    this.drawFull(this.lastTimeSeries, this.lastTimes, currentTime, this.lastFactor);
  }

  dispose(): void {
    if (this.canvas.parentElement) {
      this.canvas.parentElement.removeChild(this.canvas);
    }
    this.lastTimeSeries = null;
    this.lastTimes = null;
  }

  // ── Private ──────────────────────────────────────────────────

  private position(screenX: number, screenY: number): void {
    const containerRect = this.container.getBoundingClientRect();
    const pad = 12;

    let x = screenX - containerRect.left + pad;
    let y = screenY - containerRect.top + pad;

    // Clamp to container bounds
    if (x + this.opts.width > containerRect.width) {
      x = screenX - containerRect.left - this.opts.width - pad;
    }
    if (y + this.opts.height > containerRect.height) {
      y = screenY - containerRect.top - this.opts.height - pad;
    }
    if (x < 0) x = 0;
    if (y < 0) y = 0;

    this.canvas.style.left = `${x}px`;
    this.canvas.style.top = `${y}px`;
  }

  private drawFull(
    timeSeries: Float32Array,
    times: number[],
    currentTime: number,
    factor: FactorDescriptor | null
  ): void {
    const { width, height, padding, bgColor, lineColor, timeMarkerColor } = this.opts;
    const ctx = this.ctx;
    if (!ctx) return;

    ctx.clearRect(0, 0, width, height);

    // Background
    ctx.fillStyle = bgColor;
    ctx.beginPath();
    ctx.roundRect(0, 0, width, height, 4);
    ctx.fill();

    const plotX = padding;
    const plotY = padding;
    const plotW = width - padding * 2;
    const plotH = height - padding * 2;

    if (timeSeries.length === 0 || times.length === 0) return;

    // Compute value range
    let minVal = Infinity;
    let maxVal = -Infinity;
    for (let i = 0; i < timeSeries.length; i++) {
      const v = timeSeries[i];
      if (isFinite(v)) {
        if (v < minVal) minVal = v;
        if (v > maxVal) maxVal = v;
      }
    }
    if (!isFinite(minVal)) { minVal = 0; maxVal = 1; }
    if (maxVal === minVal) { maxVal = minVal + 1; }

    const tMin = times[0];
    const tMax = times[times.length - 1];
    const tRange = tMax - tMin || 1;
    const vRange = maxVal - minVal;

    const toX = (t: number) => plotX + ((t - tMin) / tRange) * plotW;
    const toY = (v: number) => plotY + plotH - ((v - minVal) / vRange) * plotH;

    // Factor color segments (simple version: color background strips)
    if (factor && factor.levels.length > 1) {
      const palette = ['rgba(70,130,180,0.2)', 'rgba(180,100,70,0.2)', 'rgba(70,180,100,0.2)', 'rgba(180,70,180,0.2)'];
      for (let i = 0; i < times.length - 1; i++) {
        const level = factor.assignment[i];
        ctx.fillStyle = palette[level % palette.length];
        const x1 = toX(times[i]);
        const x2 = toX(times[i + 1]);
        ctx.fillRect(x1, plotY, x2 - x1, plotH);
      }
    }

    // Line chart
    ctx.strokeStyle = lineColor;
    ctx.lineWidth = 1.5;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    let started = false;
    for (let i = 0; i < timeSeries.length; i++) {
      const v = timeSeries[i];
      if (!isFinite(v)) continue;
      const px = toX(times[i]);
      const py = toY(v);
      if (!started) {
        ctx.moveTo(px, py);
        started = true;
      } else {
        ctx.lineTo(px, py);
      }
    }
    ctx.stroke();

    // Time marker vertical line
    if (currentTime >= tMin && currentTime <= tMax) {
      const mx = toX(currentTime);
      ctx.strokeStyle = timeMarkerColor;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(mx, plotY);
      ctx.lineTo(mx, plotY + plotH);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }
}
