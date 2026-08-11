import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type {
  ControlCommandFailureCode,
  LayerControlDescriptor,
  SurfViewControlSnapshot,
  SurfViewControlSessionState
} from '../../src';

const enabled = Object.freeze({ enabled: true });

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) {
      deepFreeze(child);
    }
  }
  return value;
}

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

  const prototype = Object.getPrototypeOf(value);
  expect([Object.prototype, null], `${path} must be a plain object`).toContain(prototype);
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    expectJsonLike(child, `${path}.${key}`);
  }
}

function makeSnapshot(): SurfViewControlSnapshot {
  return deepFreeze({
    revision: 7,
    view: {
      current: null,
      anatomicalViews: [{ id: 'lateral', label: 'Lateral', availability: enabled }],
      targets: [{
        target: { kind: 'surface', surfaceId: 'lh' },
        label: 'Left cortex',
        availability: enabled
      }],
      fit: enabled,
      reset: enabled
    },
    surfaces: [{
      id: 'lh',
      label: 'Left cortex',
      hemisphere: 'left',
      visible: true,
      groupId: null,
      layers: [{
        id: 'base',
        surfaceId: 'lh',
        label: 'Anatomy',
        index: 0,
        role: 'anatomy',
        pinned: 'bottom',
        reorderable: false,
        moveUp: { enabled: false, reason: 'Already first.' },
        moveDown: { enabled: false, reason: 'Fixed in stack.' },
        visible: true,
        opacity: 1,
        blendMode: 'normal'
      }]
    }],
    selection: {
      current: { kind: 'none' },
      inspection: null,
      vertexSelection: enabled,
      parcelSelection: { enabled: false, reason: 'No atlas is loaded.' }
    },
    figure: {
      preset: { id: 'default', label: 'Default', availability: enabled },
      availablePresets: [{ id: 'default', label: 'Default', availability: enabled }],
      background: 0x000000,
      transparent: false,
      defaultWidth: 1800,
      defaultHeight: 1350,
      exportPNG: enabled
    },
    capabilities: {
      anatomicalViews: enabled,
      surfaceVisibility: enabled,
      layerVisibility: enabled,
      layerOpacity: enabled,
      layerBlendMode: enabled,
      layerOrder: enabled,
      scalarMapping: enabled,
      scientificSelection: enabled,
      figurePresets: enabled,
      figureBackground: enabled,
      exportPNG: enabled
    }
  });
}

describe('SurfViewControlTarget contract', () => {
  it('uses deeply frozen, JSON-like canonical descriptor fixtures', () => {
    const snapshot = makeSnapshot();
    expectJsonLike(snapshot);
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.surfaces)).toBe(true);
    expect(Object.isFrozen(snapshot.surfaces[0].layers[0])).toBe(true);
  });

  it('keeps unsupported layer capability families absent', () => {
    const layer: LayerControlDescriptor = makeSnapshot().surfaces[0].layers[0];
    expect(layer).not.toHaveProperty('scalarMapping');
    expect(layer).not.toHaveProperty('bivariateMapping');
    expect(layer).not.toHaveProperty('temporal');
    expect(layer).not.toHaveProperty('parcels');
    expect(layer).not.toHaveProperty('outline');
  });

  it('keeps session-local focus and disclosure out of canonical snapshots', () => {
    const snapshot = makeSnapshot();
    const session: SurfViewControlSessionState = {
      focusedSurfaceId: 'lh',
      focusedLayerId: 'base',
      expandedSections: ['layers'],
      advancedVisible: false,
      symmetricRangeLock: true
    };

    expect(snapshot).not.toHaveProperty('focusedSurfaceId');
    expect(snapshot).not.toHaveProperty('focusedLayerId');
    expect(snapshot).not.toHaveProperty('expandedSections');
    expect(session.focusedLayerId).toBe('base');
  });

  it('keeps command failure codes exhaustively named and stable', () => {
    const codes: ControlCommandFailureCode[] = [
      'surface-not-found',
      'layer-not-found',
      'group-not-found',
      'unsupported',
      'invalid-value',
      'conflict',
      'disposed'
    ];
    expect(new Set(codes).size).toBe(7);
  });

  it('keeps raw viewer implementation types out of the protocol declaration', () => {
    const source = readFileSync(
      new URL('../../src/controls/ControlTarget.ts', import.meta.url),
      'utf8'
    );
    expect(source).not.toMatch(/from ['"]three/);
    expect(source).not.toMatch(/\bTHREE\b|\bNeuroSurfaceViewer\b|\bMultiLayerNeuroSurface\b/);
    expect(source).not.toMatch(/\b(?:Float|Uint|Int)\d+Array\b/);
    expect(source).not.toMatch(/\b(?:Map|Set)</);
  });
});
