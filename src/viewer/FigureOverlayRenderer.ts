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

function drawColorbar(
  ctx: CanvasRenderingContext2D,
  options: ResolvedFigureExportOptions
): void {
  const width = ctx.canvas.width;
  const height = ctx.canvas.height;
  const fontScale = options.fontScale;
  const barWidth = Math.max(16, Math.round(width * 0.018));
  const barHeight = Math.max(140, Math.round(height * 0.28));
  const x = width - barWidth - Math.round(40 * fontScale);
  const y = height - barHeight - Math.round(44 * fontScale);
  const gradient = ctx.createLinearGradient(0, y + barHeight, 0, y);
  const colors = options.colorbarColors.length > 0
    ? options.colorbarColors
    : ['#000000', '#ffffff'];
  colors.forEach((color, index) => {
    gradient.addColorStop(colors.length === 1 ? 0 : index / (colors.length - 1), color);
  });

  ctx.save();
  ctx.fillStyle = 'rgba(255, 255, 255, 0.78)';
  ctx.fillRect(x - 8, y - 8, barWidth + 58 * fontScale, barHeight + 36 * fontScale);
  ctx.fillStyle = gradient;
  ctx.fillRect(x, y, barWidth, barHeight);
  ctx.strokeStyle = 'rgba(15, 23, 42, 0.55)';
  ctx.lineWidth = Math.max(1, fontScale);
  ctx.strokeRect(x, y, barWidth, barHeight);

  ctx.fillStyle = '#111827';
  ctx.font = `${Math.round(12 * fontScale)}px sans-serif`;
  ctx.textBaseline = 'middle';
  ctx.fillText(options.colorbarLabel, x + barWidth + 10 * fontScale, y + barHeight / 2);
  if (options.colorbarRange) {
    const [min, max] = options.colorbarRange;
    ctx.font = `${Math.round(10 * fontScale)}px sans-serif`;
    ctx.textBaseline = 'top';
    ctx.fillText(String(max), x + barWidth + 10 * fontScale, y - 1);
    ctx.textBaseline = 'bottom';
    ctx.fillText(String(min), x + barWidth + 10 * fontScale, y + barHeight + 1);
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
