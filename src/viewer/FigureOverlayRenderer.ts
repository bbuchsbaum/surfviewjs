import type {
  FigureExportLabel,
  ResolvedFigureExportOptions
} from '../StylePresets';

export function readableFigureTextColor(backgroundColor: number): string {
  const r = (backgroundColor >> 16) & 255;
  const g = (backgroundColor >> 8) & 255;
  const b = backgroundColor & 255;
  const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  return luminance > 0.55 ? '#111827' : '#f8fafc';
}

/** Draw deterministic publication overlays onto an already-rendered figure canvas. */
export function drawFigureOverlays(
  ctx: CanvasRenderingContext2D,
  options: ResolvedFigureExportOptions,
  annotationLabels: readonly FigureExportLabel[] = []
): void {
  const width = ctx.canvas.width;
  const height = ctx.canvas.height;
  const fontScale = options.fontScale;

  if (options.title) {
    ctx.save();
    ctx.fillStyle = options.transparent
      ? '#111827'
      : readableFigureTextColor(options.backgroundColor);
    ctx.font = `${Math.round(24 * fontScale)}px sans-serif`;
    ctx.textBaseline = 'top';
    ctx.fillText(options.title, 28 * fontScale, 24 * fontScale);
    if (options.subtitle) {
      ctx.font = `${Math.round(14 * fontScale)}px sans-serif`;
      ctx.fillText(options.subtitle, 28 * fontScale, 56 * fontScale);
    }
    ctx.restore();
  }

  if (options.colorbar) drawColorbar(ctx, options);
  if (options.scaleBar) drawScaleBar(ctx, options);
  if (options.roiLabels) {
    drawLabels(
      ctx,
      Array.isArray(options.roiLabels) ? options.roiLabels : annotationLabels,
      options
    );
  }

  if (options.transparent) {
    ctx.save();
    ctx.strokeStyle = 'rgba(15, 23, 42, 0.12)';
    ctx.lineWidth = Math.max(1, width / 1600);
    ctx.strokeRect(0.5, 0.5, width - 1, height - 1);
    ctx.restore();
  }
}

/** Compact tick text: integers as-is, otherwise three significant digits. */
export function formatColorbarTick(value: number): string {
  if (Number.isInteger(value)) return String(value);
  return String(Number(value.toPrecision(3)));
}

/**
 * Vertical colour key, bottom = low end of the range. Shows the layer's own
 * colormap, the masked (not drawn) threshold interval as a striped neutral
 * band with its bounds labelled, and cap triangles where drawn values extend
 * beyond the colour scale and take its end colours.
 */
function drawColorbar(
  ctx: CanvasRenderingContext2D,
  options: ResolvedFigureExportOptions
): void {
  const width = ctx.canvas.width;
  const height = ctx.canvas.height;
  const fontScale = options.fontScale;
  const barWidth = Math.max(16, Math.round(width * 0.018));
  const barHeight = Math.max(140, Math.round(height * 0.28));
  const colors = options.colorbarColors.length > 0
    ? options.colorbarColors
    : ['#000000', '#ffffff'];
  const range = options.colorbarRange;
  const caps = options.colorbarCaps ?? { low: false, high: false };
  const cap = Math.round(barWidth * 0.9);
  const pad = 8 * fontScale;
  const tickGap = 6 * fontScale;
  const tickFont = `${Math.round(10 * fontScale)}px sans-serif`;
  const titleFont = `${Math.round(12 * fontScale)}px sans-serif`;

  const ticks: Array<{ value: number; text: string }> = [];
  let band: [number, number] | null = null;
  if (range && range[1] !== range[0]) {
    ticks.push(
      { value: range[1], text: formatColorbarTick(range[1]) },
      { value: range[0], text: formatColorbarTick(range[0]) }
    );
    const threshold = options.colorbarThreshold;
    if (threshold && threshold[1] > threshold[0]) {
      const lo = Math.min(range[0], range[1]);
      const hi = Math.max(range[0], range[1]);
      const from = Math.max(lo, threshold[0]);
      const to = Math.min(hi, threshold[1]);
      if (to > from) {
        band = [from, to];
        for (const bound of threshold) {
          if (bound > lo && bound < hi) ticks.push({ value: bound, text: formatColorbarTick(bound) });
        }
      }
    }
  }

  ctx.save();
  ctx.font = tickFont;
  const tickWidth = ticks.reduce((widest, tick) => Math.max(widest, ctx.measureText(tick.text).width), 0);
  ctx.font = titleFont;
  const titleWidth = ctx.measureText(options.colorbarLabel).width;
  const right = width - Math.round(24 * fontScale);
  const x = right - pad - (ticks.length > 0 ? tickWidth + tickGap : 0) - barWidth;
  const bottom = height - Math.round(44 * fontScale);
  const y = bottom - barHeight;
  const titleY = y - (caps.high ? cap : 0) - 4 * fontScale;
  const boxLeft = Math.min(x, right - pad - titleWidth) - pad;
  const boxTop = titleY - 14 * fontScale - pad;
  const boxBottom = bottom + (caps.low ? cap : 0) + pad;
  const yOf = (value: number): number => range
    ? bottom - ((value - range[0]) / (range[1] - range[0])) * barHeight
    : bottom;

  ctx.fillStyle = 'rgba(255, 255, 255, 0.78)';
  ctx.fillRect(boxLeft, boxTop, right - boxLeft, boxBottom - boxTop);

  const gradient = ctx.createLinearGradient(0, bottom, 0, y);
  colors.forEach((color, index) => {
    gradient.addColorStop(colors.length === 1 ? 0 : index / (colors.length - 1), color);
  });
  ctx.fillStyle = gradient;
  ctx.fillRect(x, y, barWidth, barHeight);

  if (band) {
    const top = Math.max(y, Math.min(yOf(band[0]), yOf(band[1])));
    const end = Math.min(bottom, Math.max(yOf(band[0]), yOf(band[1])));
    ctx.fillStyle = '#eef0f2';
    ctx.fillRect(x, top, barWidth, end - top);
    ctx.fillStyle = '#c4c8cc';
    const stripe = Math.max(1, 2 * fontScale);
    for (let row = top; row < end; row += 2 * stripe) {
      ctx.fillRect(x, row, barWidth, Math.min(stripe, end - row));
    }
  }

  ctx.strokeStyle = 'rgba(15, 23, 42, 0.55)';
  ctx.lineWidth = Math.max(1, fontScale);
  ctx.strokeRect(x, y, barWidth, barHeight);

  const drawCap = (tipY: number, baseY: number, color: string): void => {
    ctx.beginPath();
    ctx.moveTo(x, baseY);
    ctx.lineTo(x + barWidth, baseY);
    ctx.lineTo(x + barWidth / 2, tipY);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
    ctx.stroke();
  };
  if (caps.high) drawCap(y - cap, y, colors[colors.length - 1]!);
  if (caps.low) drawCap(bottom + cap, bottom, colors[0]!);

  ctx.fillStyle = '#111827';
  ctx.font = titleFont;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'bottom';
  ctx.fillText(options.colorbarLabel, right - pad, titleY);

  ctx.font = tickFont;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  const placed: number[] = [];
  const minSpacing = 11 * fontScale;
  for (const tick of ticks) {
    const tickY = yOf(tick.value);
    if (placed.some(other => Math.abs(other - tickY) < minSpacing)) continue;
    placed.push(tickY);
    ctx.beginPath();
    ctx.moveTo(x + barWidth, tickY);
    ctx.lineTo(x + barWidth + 3 * fontScale, tickY);
    ctx.stroke();
    ctx.fillText(tick.text, x + barWidth + tickGap, tickY);
  }
  ctx.restore();
}

function drawScaleBar(
  ctx: CanvasRenderingContext2D,
  options: ResolvedFigureExportOptions
): void {
  const width = ctx.canvas.width;
  const height = ctx.canvas.height;
  const fontScale = options.fontScale;
  const barWidth = Math.max(64, Math.round(width * options.scaleBarLength));
  const x = Math.round(44 * fontScale);
  const y = height - Math.round(48 * fontScale);
  const color = options.transparent
    ? '#111827'
    : readableFigureTextColor(options.backgroundColor);

  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(2, Math.round(3 * fontScale));
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + barWidth, y);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x, y - 7 * fontScale);
  ctx.lineTo(x, y + 7 * fontScale);
  ctx.moveTo(x + barWidth, y - 7 * fontScale);
  ctx.lineTo(x + barWidth, y + 7 * fontScale);
  ctx.stroke();
  if (options.scaleBarLabel) {
    ctx.fillStyle = color;
    ctx.font = `${Math.round(12 * fontScale)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillText(options.scaleBarLabel, x + barWidth / 2, y - 10 * fontScale);
  }
  ctx.restore();
}

function drawLabels(
  ctx: CanvasRenderingContext2D,
  labels: readonly FigureExportLabel[],
  options: ResolvedFigureExportOptions
): void {
  if (labels.length === 0) return;
  const fontScale = options.fontScale;
  ctx.save();
  ctx.font = `${Math.round(12 * fontScale)}px sans-serif`;
  ctx.textBaseline = 'middle';
  labels.forEach(label => {
    const x = label.normalized ? label.x * ctx.canvas.width : label.x;
    const y = label.normalized ? label.y * ctx.canvas.height : label.y;
    const paddingX = 5 * fontScale;
    const paddingY = 3 * fontScale;
    const metrics = ctx.measureText(label.text);
    const boxWidth = metrics.width + paddingX * 2;
    const boxHeight = 16 * fontScale + paddingY * 2;
    ctx.fillStyle = label.background ?? 'rgba(255, 255, 255, 0.82)';
    ctx.fillRect(x - paddingX, y - boxHeight / 2, boxWidth, boxHeight);
    ctx.fillStyle = label.color ?? options.preset.roi.labelColor;
    ctx.fillText(label.text, x, y);
  });
  ctx.restore();
}
