import { describe, expect, it, vi } from 'vitest';
import {
  drawFigureOverlays,
  readableFigureTextColor
} from '../../src/viewer/FigureOverlayRenderer';

function contextFixture() {
  const gradient = { addColorStop: vi.fn() };
  const ctx = {
    canvas: { width: 800, height: 600 },
    save: vi.fn(),
    restore: vi.fn(),
    fillText: vi.fn(),
    fillRect: vi.fn(),
    strokeRect: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
    measureText: vi.fn(() => ({ width: 20 })),
    createLinearGradient: vi.fn(() => gradient),
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    font: '',
    textBaseline: '',
    textAlign: ''
  };
  return { ctx, gradient };
}

describe('FigureOverlayRenderer', () => {
  it('chooses legible text for light and dark figure backgrounds', () => {
    expect(readableFigureTextColor(0xffffff)).toBe('#111827');
    expect(readableFigureTextColor(0x000000)).toBe('#f8fafc');
  });

  it('draws title, fallback annotation labels, and the transparent boundary', () => {
    const { ctx } = contextFixture();
    drawFigureOverlays(ctx as unknown as CanvasRenderingContext2D, {
      title: 'Title',
      subtitle: 'Subtitle',
      transparent: true,
      backgroundColor: 0xffffff,
      fontScale: 1,
      colorbar: false,
      colorbarColors: [],
      colorbarLabel: '',
      scaleBar: false,
      scaleBarLength: 0.2,
      roiLabels: true,
      preset: { roi: { labelColor: '#123456' } }
    } as never, [{ text: 'ROI', x: 10, y: 20 }]);

    expect(ctx.fillText).toHaveBeenCalledWith('Title', 28, 24);
    expect(ctx.fillText).toHaveBeenCalledWith('Subtitle', 28, 56);
    expect(ctx.fillText).toHaveBeenCalledWith('ROI', 10, 20);
    expect(ctx.strokeRect).toHaveBeenCalledWith(0.5, 0.5, 799, 599);
  });
});
