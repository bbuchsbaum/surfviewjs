import { describe, it, expect, vi } from 'vitest';
import ColorMap from '../../src/ColorMap';

describe('ColorMap', () => {
  describe('construction', () => {
    it('creates from a preset name', () => {
      const cm = ColorMap.fromPreset('jet');
      expect(cm).toBeInstanceOf(ColorMap);
      // Verify it can produce colors (no getColors() accessor)
      cm.setRange([0, 1]);
      const c = cm.getColor(0.5);
      expect(c.length).toBeGreaterThanOrEqual(3);
    });

    it('creates from a color array', () => {
      const cm = new ColorMap([[1, 0, 0], [0, 1, 0], [0, 0, 1]]);
      cm.setRange([0, 1]);
      // Boundary colors should match input
      const first = cm.getColor(0);
      expect(first[0]).toBeCloseTo(1, 1);
      const last = cm.getColor(1);
      expect(last[2]).toBeCloseTo(1, 1);
    });

    it('falls back gracefully for unknown preset', () => {
      // fromPreset falls back to jet or first available for unknown names
      const cm = ColorMap.fromPreset('nonexistent_colormap_xyz');
      expect(cm).toBeInstanceOf(ColorMap);
    });
  });

  describe('getColor', () => {
    it('returns correct color at boundaries', () => {
      const cm = new ColorMap([[1, 0, 0, 1], [0, 0, 1, 1]]);
      cm.setRange([0, 1]);

      const low = cm.getColor(0);
      expect(low[0]).toBeCloseTo(1, 1);

      const high = cm.getColor(1);
      expect(high[2]).toBeCloseTo(1, 1);
    });

    it('clamps out-of-range values', () => {
      const cm = new ColorMap([[1, 0, 0, 1], [0, 0, 1, 1]]);
      cm.setRange([0, 1]);

      const below = cm.getColor(-5);
      expect(below[0]).toBeCloseTo(1, 1); // Clamped to min

      const above = cm.getColor(10);
      expect(above[2]).toBeCloseTo(1, 1); // Clamped to max
    });

    it('handles degenerate range (min === max)', () => {
      const cm = new ColorMap([[1, 0, 0, 1], [0, 0, 1, 1]]);
      cm.setRange([5, 5]);
      const color = cm.getColor(5);
      // Should not crash, should return a valid color
      expect(color.length).toBeGreaterThanOrEqual(3);
      expect(Number.isFinite(color[0])).toBe(true);
    });

    it('handles NaN input gracefully', () => {
      const cm = ColorMap.fromPreset('jet');
      cm.setRange([0, 1]);
      const color = cm.getColor(NaN);
      // NaN normalization produces NaN index — should not crash
      // Just verify it returns an array without throwing
      expect(Array.isArray(color)).toBe(true);
    });

    it('handles Infinity input gracefully', () => {
      const cm = ColorMap.fromPreset('jet');
      cm.setRange([0, 1]);
      const color = cm.getColor(Infinity);
      expect(Array.isArray(color)).toBe(true);
    });
  });

  describe('threshold', () => {
    it('hides values in threshold range', () => {
      const cm = new ColorMap([[1, 0, 0, 1], [0, 0, 1, 1]]);
      cm.setRange([0, 10]);
      cm.setThreshold([3, 7]);

      // Value within threshold should be hidden (alpha = 0)
      const hidden = cm.getColor(5);
      expect(hidden[3]).toBe(0);

      // Value outside threshold should be visible
      const visible = cm.getColor(1);
      expect(visible[3]).toBeGreaterThan(0);
    });

    it('shows all values when threshold min === max', () => {
      const cm = new ColorMap([[1, 0, 0, 1], [0, 0, 1, 1]]);
      cm.setRange([0, 10]);
      cm.setThreshold([0, 0]);

      const color = cm.getColor(5);
      expect(color[3]).toBeGreaterThan(0);
    });
  });

  describe('events', () => {
    it('emits rangeChanged on setRange', () => {
      const cm = ColorMap.fromPreset('jet');
      const fn = vi.fn();
      cm.on('rangeChanged', fn);
      cm.setRange([0, 10]);
      expect(fn).toHaveBeenCalledWith([0, 10]);
    });

    it('emits thresholdChanged on setThreshold', () => {
      const cm = ColorMap.fromPreset('jet');
      const fn = vi.fn();
      cm.on('thresholdChanged', fn);
      cm.setThreshold([2, 8]);
      expect(fn).toHaveBeenCalledWith([2, 8]);
    });
  });

  describe('preset maps', () => {
    it('lists available maps', () => {
      const maps = ColorMap.getAvailableMaps();
      expect(maps.length).toBeGreaterThan(5);
      expect(maps).toContain('jet');
      expect(maps).toContain('hot');
    });
  });
});
