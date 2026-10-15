import { Layer, type LayerConfig, type LayerUpdateData, assertLayerUpdateFields } from '../layers';

/** Binary categorical anatomy, drawn below maps at the fixed 0.5 contour. */
export class ReferenceLayer extends Layer {
  readonly color: string;
  private readonly membership: Float32Array;

  constructor(id: string, membership: ArrayLike<number>, color: string, config: LayerConfig = {}) {
    super(id, { ...config, blendMode: 'normal' }, {
      role: 'reference', pinned: 'bottom', reorderable: false, priority: 2
    });
    if (!/^#[a-fA-F0-9]{6}$/.test(color)) throw new TypeError('Reference color must be #rrggbb');
    for (let i = 0; i < membership.length; i++) {
      if (membership[i] !== 0 && membership[i] !== 1) {
        throw new TypeError(`Reference membership must be binary (vertex ${i})`);
      }
    }
    this.membership = Float32Array.from(membership);
    this.color = color;
  }

  copyMembership(target: Float32Array): void {
    if (target.length !== this.membership.length) throw new RangeError('Reference membership must match vertex count');
    target.set(this.membership);
  }

  getRGBAData(vertexCount: number): Float32Array {
    if (vertexCount !== this.membership.length) throw new RangeError('Reference membership must match vertex count');
    const rgba = new Float32Array(vertexCount * 4);
    const color = Number.parseInt(this.color.slice(1), 16);
    for (let i = 0; i < vertexCount; i++) {
      rgba.set([(color >> 16) / 255, ((color >> 8) & 255) / 255, (color & 255) / 255, this.membership[i]!], i * 4);
    }
    return rgba;
  }

  update(data: LayerUpdateData): void {
    assertLayerUpdateFields(data, 'ReferenceLayer', []);
    if (data.blendMode !== undefined && data.blendMode !== 'normal') throw new TypeError('Reference blend mode is fixed');
    // Validate the complete request before mutation.
    if (data.opacity !== undefined && (!Number.isFinite(data.opacity) || data.opacity < 0 || data.opacity > 1)) throw new RangeError('Invalid reference opacity');
    if (data.visible !== undefined && typeof data.visible !== 'boolean') throw new TypeError('Invalid reference visibility');
    if (data.opacity !== undefined) this.setOpacity(data.opacity);
    if (data.visible !== undefined) this.setVisible(data.visible);
  }

  dispose(): void {}
}
