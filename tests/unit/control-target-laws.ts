import { describe, expect, it, vi } from 'vitest';
import type {
  ControlCommandResult,
  SurfViewControlSnapshot,
  SurfViewControlTarget
} from '../../src';

export interface ControlTargetLawHarness {
  readonly target: SurfViewControlTarget;
  getCanonicalRevision(): number;
  runSuccessfulCommand(): ControlCommandResult;
  assertSuccessfulSnapshot(snapshot: SurfViewControlSnapshot): void;
  runInvalidCommand(): ControlCommandResult;
  runExternalMutation(): void;
  disposeFixture(): void;
}

export type ControlTargetLawHarnessFactory = () => ControlTargetLawHarness;

function expectJsonLike(value: unknown, path = '$'): void {
  if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) return;
  expect(typeof value, path).toBe('object');
  expect(ArrayBuffer.isView(value), `${path} must not contain a typed array`).toBe(false);
  expect(value, `${path} must not contain a Map`).not.toBeInstanceOf(Map);
  expect(value, `${path} must not contain a Set`).not.toBeInstanceOf(Set);

  if (Array.isArray(value)) {
    value.forEach((child, index) => expectJsonLike(child, `${path}.${index}`));
    return;
  }

  expect([Object.prototype, null], `${path} must be a plain object`).toContain(
    Object.getPrototypeOf(value)
  );
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    expectJsonLike(child, `${path}.${key}`);
  }
}

function expectDeeplyFrozen(value: unknown): void {
  if (!value || typeof value !== 'object') return;
  expect(Object.isFrozen(value)).toBe(true);
  for (const child of Object.values(value as Record<string, unknown>)) {
    expectDeeplyFrozen(child);
  }
}

/** Reusable behavioral laws for every SurfViewControlTarget adapter. */
export function runControlTargetContractLaws(
  name: string,
  createHarness: ControlTargetLawHarnessFactory
): void {
  describe(`${name} control-target laws`, () => {
    it('synchronously delivers one immutable JSON-like current snapshot', () => {
      const harness = createHarness();
      try {
        const listener = vi.fn();
        const subscription = harness.target.subscribe(listener);
        const snapshot = harness.target.getSnapshot();

        expect(listener).toHaveBeenCalledOnce();
        expect(listener).toHaveBeenCalledWith(snapshot);
        expectJsonLike(snapshot);
        expectDeeplyFrozen(snapshot);
        expect(subscription.closed).toBe(false);
      } finally {
        harness.target.dispose();
        harness.disposeFixture();
      }
    });

    it('reflects every successful command in the next canonical snapshot', () => {
      const harness = createHarness();
      try {
        const before = harness.target.getSnapshot();
        const listener = vi.fn();
        harness.target.subscribe(listener);

        const result = harness.runSuccessfulCommand();
        const after = harness.target.getSnapshot();

        expect(result).toEqual({ ok: true });
        expect(after).not.toBe(before);
        expect(after.revision).toBeGreaterThan(before.revision);
        expect(after.revision).toBe(harness.getCanonicalRevision());
        expect(listener).toHaveBeenLastCalledWith(after);
        harness.assertSuccessfulSnapshot(after);
      } finally {
        harness.target.dispose();
        harness.disposeFixture();
      }
    });

    it('does not mutate or notify for an invalid command', () => {
      const harness = createHarness();
      try {
        const before = harness.target.getSnapshot();
        const revision = harness.getCanonicalRevision();
        const listener = vi.fn();
        harness.target.subscribe(listener);
        listener.mockClear();

        const result = harness.runInvalidCommand();

        expect(result.ok).toBe(false);
        expect(harness.target.getSnapshot()).toBe(before);
        expect(harness.getCanonicalRevision()).toBe(revision);
        expect(listener).not.toHaveBeenCalled();
      } finally {
        harness.target.dispose();
        harness.disposeFixture();
      }
    });

    it('supports idempotent unsubscribe without affecting the target', () => {
      const harness = createHarness();
      try {
        const listener = vi.fn();
        const subscription = harness.target.subscribe(listener);
        subscription.unsubscribe();
        subscription.unsubscribe();
        listener.mockClear();

        harness.runExternalMutation();

        expect(subscription.closed).toBe(true);
        expect(listener).not.toHaveBeenCalled();
        expect(harness.target.isDisposed()).toBe(false);
      } finally {
        harness.target.dispose();
        harness.disposeFixture();
      }
    });

    it('stops notifications and rejects commands after idempotent disposal', () => {
      const harness = createHarness();
      const listener = vi.fn();
      const subscription = harness.target.subscribe(listener);
      const lastSnapshot = harness.target.getSnapshot();
      listener.mockClear();

      harness.target.dispose();
      harness.target.dispose();
      harness.runExternalMutation();
      const result = harness.runSuccessfulCommand();

      expect(subscription.closed).toBe(true);
      expect(harness.target.isDisposed()).toBe(true);
      expect(harness.target.getSnapshot()).toBe(lastSnapshot);
      expect(result).toMatchObject({ ok: false, code: 'disposed' });
      expect(listener).not.toHaveBeenCalled();
      harness.disposeFixture();
    });
  });
}
