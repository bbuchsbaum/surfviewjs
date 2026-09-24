import { describe, expect, it } from 'vitest';
import { DataLayer } from '../../src/layers';

const RANGE: [number, number] = [-5, 5];

function layer(
  values: number[],
  threshold: [number, number] = [-1, 1],
  indices: number[] | null = null,
  range: [number, number] = RANGE
): DataLayer {
  return new DataLayer('map', values, indices, 'viridis', { range, threshold });
}

/** Reference colours: the same colormap without a mask. */
function referenceRGBA(values: number[], range: [number, number] = RANGE): Float32Array {
  return layer(values, [0, 0], null, range).getRGBAData(values.length);
}

function buffers(vertexCount: number) {
  return {
    colors: new Float32Array(vertexCount * 4).fill(7),
    edges: new Float32Array(vertexCount).fill(7)
  };
}

describe('DataLayer.writeThresholdEdgeAttributes', () => {
  it('returns false and leaves buffers untouched without an active mask', () => {
    const { colors, edges } = buffers(3);
    expect(layer([1, 2, 3], [0, 0]).writeThresholdEdgeAttributes(3, colors, edges)).toBe(false);
    expect(layer([1, 2, 3], [2, 2]).writeThresholdEdgeAttributes(3, colors, edges)).toBe(false);
    expect(Array.from(colors).every(value => value === 7)).toBe(true);
    expect(Array.from(edges).every(value => value === 7)).toBe(true);
  });

  it('returns false once the layer data has been released', () => {
    const disposed = layer([3, 0, -3]);
    disposed.dispose();
    const { colors, edges } = buffers(3);
    expect(disposed.writeThresholdEdgeAttributes(3, colors, edges)).toBe(false);
  });

  it('writes a signed distance: positive outside the mask, negative inside', () => {
    const { colors, edges } = buffers(5);
    expect(layer([3, 0.5, -0.2, -3, 1]).writeThresholdEdgeAttributes(5, colors, edges)).toBe(true);
    expect(edges[0]).toBeCloseTo(2, 6);    // 3 above high = 1
    expect(edges[1]).toBeCloseTo(-0.5, 6); // inside, nearer the upper edge
    expect(edges[2]).toBeCloseTo(-0.8, 6); // inside, nearer the lower edge
    expect(edges[3]).toBeCloseTo(2, 6);    // -3 below low = -1
    expect(edges[4]).toBeCloseTo(0, 6);    // exactly on the edge
  });

  it('colours visible vertices with their own colour and masked ones with the colour just outside the nearest edge', () => {
    const { colors, edges } = buffers(4);
    layer([3, 0.5, -0.2, -3]).writeThresholdEdgeAttributes(4, colors, edges);
    const nudge = 10 * 1e-6;
    const expected = referenceRGBA([3, 1 + nudge, -1 - nudge, -3]);
    for (let channel = 0; channel < 16; channel++) {
      if (channel % 4 === 3) {
        expect(colors[channel]).toBe(1);
      } else {
        expect(colors[channel]).toBeCloseTo(expected[channel]!, 6);
      }
    }
    // Upper-edge and lower-edge colours differ, so masked vertices take the nearer side.
    expect(Array.from(colors.subarray(4, 7))).not.toEqual(Array.from(colors.subarray(8, 11)));
  });

  it('hides vertices without finite data using a negative edge and zero colour', () => {
    const { colors, edges } = buffers(4);
    // Dense data shorter than the surface, plus a NaN value.
    layer([3, Number.NaN]).writeThresholdEdgeAttributes(4, colors, edges);
    for (const vertex of [1, 2, 3]) {
      expect(edges[vertex]).toBeLessThan(0);
      expect(Array.from(colors.subarray(vertex * 4, vertex * 4 + 4))).toEqual([0, 0, 0, 0]);
    }
    // The hidden distance is at least the data span, so interpolation to a
    // shown neighbour never reaches the isoline early.
    expect(edges[1]).toBeLessThanOrEqual(-10);
    expect(edges[0]).toBeGreaterThan(0);
  });

  it('scales the hidden distance by the threshold when it exceeds the range', () => {
    const { colors, edges } = buffers(2);
    layer([5], [-4, 4], null, [0, 1]).writeThresholdEdgeAttributes(2, colors, edges);
    expect(edges[0]).toBeCloseTo(1, 6);
    expect(edges[1]).toBeCloseTo(-8, 6);
  });

  it('honours sparse indices and ignores indices beyond the vertex count', () => {
    const { colors, edges } = buffers(6);
    const sparse = layer([3, 0.5, 4], [-1, 1], [4, 1, 9]);
    expect(sparse.writeThresholdEdgeAttributes(6, colors, edges)).toBe(true);
    expect(edges[4]).toBeCloseTo(2, 6);
    expect(edges[1]).toBeCloseTo(-0.5, 6);
    for (const vertex of [0, 2, 3, 5]) {
      expect(edges[vertex]).toBeLessThan(0);
      expect(colors[vertex * 4 + 3]).toBe(0);
    }
    expect(colors[4 * 4 + 3]).toBe(1);
    expect(colors[1 * 4 + 3]).toBe(1);
  });

  it('rejects buffers that do not match the vertex count', () => {
    const active = layer([3, 0, -3]);
    expect(() => active.writeThresholdEdgeAttributes(3, new Float32Array(8), new Float32Array(3)))
      .toThrow(RangeError);
    expect(() => active.writeThresholdEdgeAttributes(3, new Float32Array(12), new Float32Array(4)))
      .toThrow(RangeError);
  });

  it('follows threshold updates', () => {
    const map = layer([3, 0.5]);
    const { colors, edges } = buffers(2);
    map.setThreshold([-4, 4]);
    map.writeThresholdEdgeAttributes(2, colors, edges);
    expect(edges[0]).toBeCloseTo(-1, 6);
    map.setThreshold([0, 0]);
    expect(map.writeThresholdEdgeAttributes(2, colors, edges)).toBe(false);
  });
});
