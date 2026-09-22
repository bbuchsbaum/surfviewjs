import { describe, expect, it } from 'vitest';
import { BilateralSurfaceGroupRegistry } from '../../src/viewer/BilateralSurfaceGroupRegistry';

function fixture() {
  let disposed = false;
  const surfaces = new Map([
    ['left', { hemisphere: 'left' }],
    ['right', { hemisphere: 'right' }],
    ['other-left', { hemisphere: 'lh' }],
    ['unknown', { hemisphere: 'unknown' }]
  ]);
  const registry = new BilateralSurfaceGroupRegistry({
    isDisposed: () => disposed,
    getSurface: id => surfaces.get(id),
    surfaceEntries: () => surfaces.entries()
  });
  return { registry, surfaces, dispose: () => { disposed = true; } };
}

describe('BilateralSurfaceGroupRegistry', () => {
  it('registers, sorts, queries, and removes explicit membership', () => {
    const { registry } = fixture();
    expect(registry.register({
      id: ' pair ',
      leftSurfaceId: 'left',
      rightSurfaceId: 'right'
    })).toEqual({
      ok: true,
      group: { id: 'pair', leftSurfaceId: 'left', rightSurfaceId: 'right' }
    });
    expect(registry.get('pair')).toEqual({
      id: 'pair',
      leftSurfaceId: 'left',
      rightSurfaceId: 'right'
    });
    expect(registry.removeForSurface('left')?.id).toBe('pair');
    expect(registry.getAll()).toEqual([]);
  });

  it('rejects malformed, missing, mislabelled, duplicate, and occupied groups', () => {
    const { registry } = fixture();
    expect(registry.register({ id: ' ', leftSurfaceId: 'left', rightSurfaceId: 'right' }))
      .toMatchObject({ ok: false, code: 'invalid-group-id' });
    expect(registry.register({ id: 'same', leftSurfaceId: 'left', rightSurfaceId: 'left' }))
      .toMatchObject({ ok: false, code: 'duplicate-surface' });
    expect(registry.register({ id: 'missing', leftSurfaceId: 'left', rightSurfaceId: 'absent' }))
      .toMatchObject({ ok: false, code: 'surface-not-found' });
    expect(registry.register({ id: 'hemi', leftSurfaceId: 'unknown', rightSurfaceId: 'right' }))
      .toMatchObject({ ok: false, code: 'invalid-hemisphere' });

    registry.register({ id: 'pair', leftSurfaceId: 'left', rightSurfaceId: 'right' });
    expect(registry.register({ id: 'pair', leftSurfaceId: 'other-left', rightSurfaceId: 'right' }))
      .toMatchObject({ ok: false, code: 'group-id-exists' });
    expect(registry.register({ id: 'occupied', leftSurfaceId: 'other-left', rightSurfaceId: 'right' }))
      .toMatchObject({ ok: false, code: 'surface-already-grouped' });
  });

  it('reports anatomical capabilities without inferring bilateral groups', () => {
    const { registry } = fixture();
    const capabilities = registry.getCapabilities();
    expect(capabilities.singleSurfaceIds).toEqual(['left', 'other-left', 'right']);
    expect(capabilities.bilateralGroups).toEqual([]);
  });

  it('returns disposed failures without mutating state', () => {
    const { registry, dispose } = fixture();
    dispose();
    expect(registry.register({ id: 'pair', leftSurfaceId: 'left', rightSurfaceId: 'right' }))
      .toMatchObject({ ok: false, code: 'disposed' });
    expect(registry.unregister('pair')).toMatchObject({ ok: false, code: 'disposed' });
    expect(registry.getAll()).toEqual([]);
  });
});
