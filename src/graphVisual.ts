export type NodeId = string | number;

export interface GraphEdge {
  source: NodeId;
  target: NodeId;
}

export interface GraphStyle {
  opacity?: number;
  scale?: number;
  borderOpacity?: number;
  borderWidth?: number;
  color?: string;
  pattern?: 'solid' | 'dashed' | 'dotted';
  glow?: number;
  [key: string]: unknown;
}

export type EdgeMetricFn = (source: NodeId, target: NodeId) => number;
export type FocusPolicy = 'single' | 'multi';

export interface GraphBoundaryLayerConfig {
  edgeMetric: EdgeMetricFn;
  metricRange?: [number, number];
  widthMap?: (normalizedMetric: number) => number;
  opacityMap?: (normalizedMetric: number) => number;
  colorMap?: (normalizedMetric: number) => string;
  patternMap?: (normalizedMetric: number) => GraphStyle['pattern'];
  glowMap?: (normalizedMetric: number) => number;
}

export interface ResolvedEdgeStyle extends GraphStyle {
  metric: number;
  normalizedMetric: number;
}

export interface NeighborhoodLensConfig {
  maxHops: number;
  focusPolicy?: FocusPolicy;
  shellStyle?: (hop: number) => GraphStyle;
  contextStyle?: GraphStyle;
}

export interface QualityChannelConfig {
  field: string;
  interpretation: 'higher-is-better' | 'lower-is-better' | 'two-sided';
  visualChannel: 'border' | 'halo' | 'pattern' | 'texture' | 'opacity';
  domain?: [number, number];
  map: (normalizedValue: number, rawValue: number) => unknown;
}

export interface QualityChannelResult {
  field: string;
  channel: QualityChannelConfig['visualChannel'];
  rawValue: number;
  normalizedValue: number;
  mappedValue: unknown;
}

export function buildAdjacency(edges: GraphEdge[], directed: boolean = false): Map<NodeId, NodeId[]> {
  const adjacency = new Map<NodeId, NodeId[]>();

  const add = (from: NodeId, to: NodeId) => {
    if (!adjacency.has(from)) {
      adjacency.set(from, []);
    }
    adjacency.get(from)!.push(to);
  };

  for (const edge of edges) {
    add(edge.source, edge.target);
    if (!directed) {
      add(edge.target, edge.source);
    }
  }

  return adjacency;
}

export function computeNeighborhoodShells(
  adjacency: Map<NodeId, ArrayLike<NodeId>>,
  focus: NodeId | NodeId[],
  maxHops: number
): Map<NodeId, number> {
  if (!Number.isInteger(maxHops) || maxHops < 0) {
    throw new Error("'maxHops' must be a non-negative integer");
  }

  const focusNodes = Array.isArray(focus) ? focus : [focus];
  if (focusNodes.length === 0) {
    throw new Error("'focus' must include at least one node");
  }

  const shells = new Map<NodeId, number>();
  const queue: Array<{ node: NodeId; hop: number }> = [];

  for (const node of focusNodes) {
    if (!shells.has(node)) {
      shells.set(node, 0);
      queue.push({ node, hop: 0 });
    }
  }

  let q = 0;
  while (q < queue.length) {
    const current = queue[q++];
    if (current.hop >= maxHops) {
      continue;
    }

    const neighbors = adjacency.get(current.node) || [];
    for (let i = 0; i < neighbors.length; i++) {
      const neighbor = neighbors[i];
      if (shells.has(neighbor)) {
        continue;
      }
      const nextHop = current.hop + 1;
      if (nextHop <= maxHops) {
        shells.set(neighbor, nextHop);
        queue.push({ node: neighbor, hop: nextHop });
      }
    }
  }

  return shells;
}

export function createDefaultShellStyle(hop: number): GraphStyle {
  const opacity = Math.max(0.2, 1 - hop * 0.22);
  const scale = Math.max(0.95, 1 - hop * 0.03);
  const borderOpacity = Math.max(0.25, 1 - hop * 0.2);

  return {
    opacity,
    scale,
    borderOpacity
  };
}

export function resolveNeighborhoodLensStyles(
  adjacency: Map<NodeId, ArrayLike<NodeId>>,
  focus: NodeId | NodeId[],
  config: NeighborhoodLensConfig
): Map<NodeId, GraphStyle> {
  const shellStyle = config.shellStyle || createDefaultShellStyle;
  const contextStyle: GraphStyle = config.contextStyle || { opacity: 0.14 };
  const shells = computeNeighborhoodShells(adjacency, focus, config.maxHops);
  const out = new Map<NodeId, GraphStyle>();

  for (const node of adjacency.keys()) {
    if (shells.has(node)) {
      out.set(node, shellStyle(shells.get(node)!));
    } else {
      out.set(node, contextStyle);
    }
  }

  return out;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function normalizeLinear(value: number, domain: [number, number]): number {
  const [min, max] = domain;
  if (!Number.isFinite(value) || !Number.isFinite(min) || !Number.isFinite(max) || min === max) {
    return 0;
  }
  return clamp01((value - min) / (max - min));
}

function inferMetricRange(values: number[]): [number, number] {
  if (values.length === 0) return [0, 1];
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < values.length; i++) {
    const value = values[i];
    if (!Number.isFinite(value)) continue;
    min = Math.min(min, value);
    max = Math.max(max, value);
  }
  if (min === Infinity || max === -Infinity) return [0, 1];
  if (min === max) return [min, min + 1];
  return [min, max];
}

export function resolveBoundaryStyles(
  edges: GraphEdge[],
  config: GraphBoundaryLayerConfig
): ResolvedEdgeStyle[] {
  const metrics = edges.map(edge => config.edgeMetric(edge.source, edge.target));
  const metricRange = config.metricRange || inferMetricRange(metrics);
  const widthMap = config.widthMap || ((n: number) => 0.5 + n * 2.5);
  const opacityMap = config.opacityMap || ((n: number) => 0.2 + n * 0.8);
  const colorMap = config.colorMap || ((n: number) => (n > 0.5 ? '#f59e0b' : '#9ca3af'));

  return edges.map((edge, idx) => {
    const metric = metrics[idx];
    const normalized = normalizeLinear(metric, metricRange);
    return {
      metric,
      normalizedMetric: normalized,
      borderWidth: widthMap(normalized),
      opacity: opacityMap(normalized),
      color: colorMap(normalized),
      pattern: config.patternMap ? config.patternMap(normalized) : 'solid',
      glow: config.glowMap ? config.glowMap(normalized) : 0
    };
  });
}

export function createDifferenceEdgeMetric(
  nodeValues: Map<NodeId, number> | Record<string, number>,
  options: { absolute?: boolean } = {}
): EdgeMetricFn {
  const absolute = options.absolute ?? true;

  const getValue = (node: NodeId): number => {
    if (nodeValues instanceof Map) {
      return nodeValues.get(node) ?? Number.NaN;
    }
    return nodeValues[String(node)];
  };

  return (source: NodeId, target: NodeId): number => {
    const a = getValue(source);
    const b = getValue(target);
    if (!Number.isFinite(a) || !Number.isFinite(b)) {
      return Number.NaN;
    }
    const diff = a - b;
    return absolute ? Math.abs(diff) : diff;
  };
}

function normalizeQuality(
  rawValue: number,
  interpretation: QualityChannelConfig['interpretation'],
  domain: [number, number]
): number {
  if (interpretation === 'two-sided') {
    const maxAbs = Math.max(Math.abs(domain[0]), Math.abs(domain[1]), 1e-9);
    return clamp01(Math.abs(rawValue) / maxAbs);
  }

  const linear = normalizeLinear(rawValue, domain);
  if (interpretation === 'higher-is-better') {
    return linear;
  }
  return 1 - linear;
}

export function mapQualityChannelValue(
  rawValue: number,
  config: QualityChannelConfig
): QualityChannelResult {
  if (!Number.isFinite(rawValue)) {
    throw new Error("'rawValue' must be a finite number");
  }

  const domain = config.domain || [0, 1];
  const normalized = normalizeQuality(rawValue, config.interpretation, domain);

  return {
    field: config.field,
    channel: config.visualChannel,
    rawValue,
    normalizedValue: normalized,
    mappedValue: config.map(normalized, rawValue)
  };
}

export function createOpacityQualityChannel(
  field: string,
  interpretation: QualityChannelConfig['interpretation'] = 'higher-is-better',
  domain: [number, number] = [0, 1]
): QualityChannelConfig {
  return {
    field,
    interpretation,
    visualChannel: 'opacity',
    domain,
    map: (normalized: number) => 0.2 + normalized * 0.8
  };
}

export function createPatternQualityChannel(
  field: string,
  interpretation: QualityChannelConfig['interpretation'] = 'higher-is-better',
  domain: [number, number] = [0, 1]
): QualityChannelConfig {
  return {
    field,
    interpretation,
    visualChannel: 'pattern',
    domain,
    map: (normalized: number) => {
      if (normalized > 0.75) return 'solid';
      if (normalized > 0.45) return 'dashed';
      return 'dotted';
    }
  };
}
