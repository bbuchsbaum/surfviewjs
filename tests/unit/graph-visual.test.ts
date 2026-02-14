import { describe, it, expect } from 'vitest';
import {
  buildAdjacency,
  computeNeighborhoodShells,
  resolveNeighborhoodLensStyles,
  resolveBoundaryStyles,
  createDifferenceEdgeMetric,
  mapQualityChannelValue,
  createOpacityQualityChannel,
  createPatternQualityChannel,
  type GraphEdge
} from '../../src/graphVisual';

describe('graphVisual', () => {
  const edges: GraphEdge[] = [
    { source: 1, target: 2 },
    { source: 2, target: 3 },
    { source: 3, target: 4 },
    { source: 3, target: 5 }
  ];

  it('buildAdjacency builds undirected graph by default', () => {
    const adjacency = buildAdjacency(edges);

    expect(adjacency.get(1)).toEqual([2]);
    expect(adjacency.get(2)).toContain(1);
    expect(adjacency.get(2)).toContain(3);
    expect(adjacency.get(5)).toEqual([3]);
  });

  it('computeNeighborhoodShells computes BFS hops from focus', () => {
    const adjacency = buildAdjacency(edges);
    const shells = computeNeighborhoodShells(adjacency, 2, 2);

    expect(shells.get(2)).toBe(0);
    expect(shells.get(1)).toBe(1);
    expect(shells.get(3)).toBe(1);
    expect(shells.get(4)).toBe(2);
    expect(shells.get(5)).toBe(2);
  });

  it('resolveNeighborhoodLensStyles includes focus and context styles', () => {
    const adjacency = buildAdjacency(edges);
    const styles = resolveNeighborhoodLensStyles(adjacency, 2, {
      maxHops: 1,
      contextStyle: { opacity: 0.05 }
    });

    expect(styles.get(2)?.opacity).toBeGreaterThan(0.9);
    expect(styles.get(1)?.opacity).toBeGreaterThan(0.6);
    expect(styles.get(4)?.opacity).toBe(0.05);
  });

  it('createDifferenceEdgeMetric computes edge deltas from node values', () => {
    const metric = createDifferenceEdgeMetric({
      '1': 1,
      '2': 4,
      '3': 2,
      '4': 10,
      '5': 2
    });

    expect(metric(1, 2)).toBe(3);
    expect(metric(3, 5)).toBe(0);
  });

  it('resolveBoundaryStyles maps metrics to style channels', () => {
    const metric = createDifferenceEdgeMetric({
      '1': 1,
      '2': 4,
      '3': 2,
      '4': 10,
      '5': 2
    });
    const styles = resolveBoundaryStyles(edges, {
      edgeMetric: metric,
      metricRange: [0, 8],
      widthMap: n => 1 + n * 3,
      opacityMap: n => 0.1 + n * 0.9
    });

    expect(styles).toHaveLength(edges.length);
    expect(styles[0].borderWidth).toBeCloseTo(2.125, 6);
    expect(styles[0].opacity).toBeGreaterThan(0.1);
    expect(styles[3].normalizedMetric).toBeCloseTo(0, 6);
  });

  it('mapQualityChannelValue supports higher-is-better and lower-is-better', () => {
    const high = createOpacityQualityChannel('confidence', 'higher-is-better', [0, 1]);
    const low = createOpacityQualityChannel('uncertainty', 'lower-is-better', [0, 1]);

    const highResult = mapQualityChannelValue(0.8, high);
    const lowResult = mapQualityChannelValue(0.8, low);

    expect(highResult.normalizedValue).toBeCloseTo(0.8, 6);
    expect(lowResult.normalizedValue).toBeCloseTo(0.2, 6);
    expect(highResult.mappedValue).toBeGreaterThan(lowResult.mappedValue as number);
  });

  it('createPatternQualityChannel returns pattern tiers', () => {
    const cfg = createPatternQualityChannel('reliability', 'higher-is-better', [0, 1]);

    const hi = mapQualityChannelValue(0.9, cfg);
    const mid = mapQualityChannelValue(0.6, cfg);
    const lo = mapQualityChannelValue(0.1, cfg);

    expect(hi.mappedValue).toBe('solid');
    expect(mid.mappedValue).toBe('dashed');
    expect(lo.mappedValue).toBe('dotted');
  });
});
