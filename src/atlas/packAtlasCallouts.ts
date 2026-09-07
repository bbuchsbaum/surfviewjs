/** Least-squares packing of ordered labels along one margin.
 * Subtract required separations, apply isotonic regression, then restore them.
 * This shares displacement across a cluster instead of pushing it to one side.
 */
export function packAtlasCallouts(anchors: number[], sizes: number[], gap: number,
  minimum: number, maximum: number): number[] | null {
  if (!anchors.length) return [];
  const offsets = [0];
  for (let i = 1; i < anchors.length; i++) offsets.push(offsets[i - 1]! + (sizes[i - 1]! + sizes[i]!) / 2 + gap);
  const lower = minimum + sizes[0]! / 2;
  const upper = maximum - sizes[sizes.length - 1]! / 2 - offsets[offsets.length - 1]!;
  if (upper < lower) return null;
  const blocks: { start: number; end: number; sum: number; count: number }[] = [];
  for (let i = 0; i < anchors.length; i++) {
    blocks.push({ start: i, end: i, sum: anchors[i]! - offsets[i]!, count: 1 });
    while (blocks.length > 1) {
      const right = blocks[blocks.length - 1]!, left = blocks[blocks.length - 2]!;
      if (left.sum / left.count <= right.sum / right.count) break;
      blocks.pop(); left.end = right.end; left.sum += right.sum; left.count += right.count;
    }
  }
  const result = new Array<number>(anchors.length);
  for (const block of blocks) {
    const mean = Math.max(lower, Math.min(upper, block.sum / block.count));
    for (let i = block.start; i <= block.end; i++) result[i] = mean + offsets[i]!;
  }
  return result;
}
