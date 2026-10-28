export type BarycentricPoint = readonly [number, number, number];
export interface LabelPartition {
  pieces: Array<{ label: number; polygon: BarycentricPoint[] }>;
  boundaries: Array<{ from: BarycentricPoint; to: BarycentricPoint; left: number; right: number }>;
}
const V: readonly BarycentricPoint[] = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
const C: BarycentricPoint = [1 / 3, 1 / 3, 1 / 3];
const mid = (a: number, b: number): BarycentricPoint => [0, 1, 2].map(i => i === a || i === b ? 0.5 : 0) as unknown as BarycentricPoint;

/** Shared categorical face partition: midpoint cuts, with centroid junctions for three labels. */
export function partitionLabelTriangle(labels: readonly [number, number, number]): LabelPartition {
  const unique = new Set(labels);
  if (unique.size === 1) return { pieces: [{ label: labels[0], polygon: [...V] }], boundaries: [] };
  if (unique.size === 2) {
    const a = labels.findIndex(label => labels.filter(other => other === label).length === 1), b = (a + 1) % 3, c = (a + 2) % 3;
    const ab = mid(a, b), ac = mid(a, c);
    return { pieces: [{ label: labels[a]!, polygon: [V[a]!, ab, ac] }, { label: labels[b]!, polygon: [V[b]!, V[c]!, ac, ab] }],
      boundaries: [{ from: ab, to: ac, left: labels[a]!, right: labels[b]! }] };
  }
  return { pieces: [0, 1, 2].map(a => ({ label: labels[a]!, polygon: [V[a]!, mid(a, (a + 1) % 3), C, mid(a, (a + 2) % 3)] })),
    boundaries: [0, 1, 2].map(a => ({ from: mid(a, (a + 1) % 3), to: C, left: labels[a]!, right: labels[(a + 1) % 3]! })) };
}
