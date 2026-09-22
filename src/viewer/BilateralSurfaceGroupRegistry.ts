import {
  ANATOMICAL_VIEWS,
  freezeBilateralSurfaceGroup,
  normalizeAnatomicalHemisphere
} from '../AnatomicalView';
import type {
  AnatomicalViewCapabilities,
  BilateralSurfaceGroup,
  BilateralSurfaceGroupResult
} from '../AnatomicalView';

export interface AnatomicalSurfaceDescriptor {
  readonly hemisphere: string;
}

export interface BilateralSurfaceGroupRegistryHost {
  isDisposed(): boolean;
  getSurface(id: string): AnatomicalSurfaceDescriptor | undefined;
  surfaceEntries(): Iterable<readonly [string, AnatomicalSurfaceDescriptor]>;
}

/** Owns explicit bilateral group membership; it never infers groups from names. */
export class BilateralSurfaceGroupRegistry {
  private readonly groups = new Map<string, BilateralSurfaceGroup>();
  private readonly membership = new Map<string, string>();

  constructor(private readonly host: BilateralSurfaceGroupRegistryHost) {}

  register(group: BilateralSurfaceGroup): BilateralSurfaceGroupResult {
    if (this.host.isDisposed()) return disposedFailure();
    const id = group.id.trim();
    if (!id) {
      return failure('invalid-group-id', 'A bilateral surface group requires a non-empty id.');
    }
    if (this.groups.has(id)) {
      return failure('group-id-exists', `Bilateral surface group "${id}" already exists.`);
    }
    if (group.leftSurfaceId === group.rightSurfaceId) {
      return failure('duplicate-surface', 'The left and right members must be different surfaces.');
    }

    const left = this.host.getSurface(group.leftSurfaceId);
    const right = this.host.getSurface(group.rightSurfaceId);
    if (!left || !right) {
      const missing = !left ? group.leftSurfaceId : group.rightSurfaceId;
      return failure('surface-not-found', `Surface "${missing}" was not found.`);
    }
    if (normalizeAnatomicalHemisphere(left.hemisphere) !== 'left') {
      return failure(
        'invalid-hemisphere',
        `Surface "${group.leftSurfaceId}" is not marked as the left hemisphere.`
      );
    }
    if (normalizeAnatomicalHemisphere(right.hemisphere) !== 'right') {
      return failure(
        'invalid-hemisphere',
        `Surface "${group.rightSurfaceId}" is not marked as the right hemisphere.`
      );
    }
    const occupiedSurfaceId = [group.leftSurfaceId, group.rightSurfaceId]
      .find(surfaceId => this.membership.has(surfaceId));
    if (occupiedSurfaceId) {
      return failure(
        'surface-already-grouped',
        `Surface "${occupiedSurfaceId}" already belongs to bilateral surface group ` +
          `"${this.membership.get(occupiedSurfaceId)}".`
      );
    }

    const registered = freezeBilateralSurfaceGroup({
      id,
      leftSurfaceId: group.leftSurfaceId,
      rightSurfaceId: group.rightSurfaceId
    });
    this.groups.set(id, registered);
    this.membership.set(registered.leftSurfaceId, id);
    this.membership.set(registered.rightSurfaceId, id);
    return Object.freeze({ ok: true, group: registered });
  }

  unregister(groupId: string): BilateralSurfaceGroupResult {
    if (this.host.isDisposed()) return disposedFailure();
    const group = this.remove(groupId);
    if (!group) {
      return failure('group-not-found', `Bilateral surface group "${groupId}" was not found.`);
    }
    return Object.freeze({ ok: true, group });
  }

  remove(groupId: string): BilateralSurfaceGroup | null {
    const group = this.groups.get(groupId);
    if (!group) return null;
    this.groups.delete(groupId);
    this.membership.delete(group.leftSurfaceId);
    this.membership.delete(group.rightSurfaceId);
    return group;
  }

  removeForSurface(surfaceId: string): BilateralSurfaceGroup | null {
    const groupId = this.membership.get(surfaceId);
    return groupId ? this.remove(groupId) : null;
  }

  get(groupId: string): BilateralSurfaceGroup | null {
    return this.groups.get(groupId) ?? null;
  }

  getAll(): readonly BilateralSurfaceGroup[] {
    return Object.freeze(
      [...this.groups.values()].sort((left, right) => left.id.localeCompare(right.id))
    );
  }

  getCapabilities(): AnatomicalViewCapabilities {
    const singleSurfaceIds = [...this.host.surfaceEntries()]
      .filter(([, surface]) => normalizeAnatomicalHemisphere(surface.hemisphere) !== null)
      .map(([surfaceId]) => surfaceId)
      .sort();
    return Object.freeze({
      views: ANATOMICAL_VIEWS,
      singleSurfaceIds: Object.freeze(singleSurfaceIds),
      bilateralGroups: this.getAll()
    });
  }

  clear(): void {
    this.groups.clear();
    this.membership.clear();
  }
}

function disposedFailure(): BilateralSurfaceGroupResult {
  return failure('disposed', 'The viewer has been disposed.');
}

function failure(
  code: Exclude<BilateralSurfaceGroupResult, { ok: true }>['code'],
  message: string
): BilateralSurfaceGroupResult {
  return Object.freeze({ ok: false, code, message });
}
