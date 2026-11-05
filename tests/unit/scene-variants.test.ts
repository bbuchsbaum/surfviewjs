import { webcrypto } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  SceneManifestError,
  createSceneAsset,
  sceneGeometryInitialVariant,
  validateSceneManifest
} from '../../src/scene';
import type { SurfViewSceneManifest } from '../../src/scene';
import {
  layoutReportAnatomicalBrain,
  relayoutReportMeshesInPlace
} from '../../src/report/ReportSceneController';
import { fixtureManifest } from './scene-manifest.test';

beforeAll(() => {
  if (!globalThis.crypto?.subtle) {
    Object.defineProperty(globalThis, 'crypto', { configurable: true, value: webcrypto });
  }
});

async function withVariants(): Promise<SurfViewSceneManifest> {
  const manifest = await fixtureManifest(true);
  for (const geometry of Object.values(manifest.geometries)) {
    const sign = geometry.hemisphere === 'left' ? -1 : 1;
    const pial = await createSceneAsset(
      [0, 0, 0, 2 * sign, 0, 0, 0, 2, 0],
      { role: 'vertices', dtype: 'float32', shape: [3, 3], inline: true }
    );
    manifest.assets[pial.descriptor.id] = pial.descriptor;
    geometry.variants = { inflated: geometry.vertices, pial: pial.descriptor.id };
  }
  return manifest;
}

describe('scene geometry variants', () => {
  it('accepts matching variant tables and reports the initial embedding', async () => {
    const manifest = await withVariants();
    expect(() => validateSceneManifest(manifest)).not.toThrow();
    expect(sceneGeometryInitialVariant(manifest.geometries.left!)).toBe('inflated');
  });

  it('requires the displayed vertices to be one of the variants', async () => {
    const manifest = await withVariants();
    const left = manifest.geometries.left!;
    left.variants = { pial: left.variants!.pial!, other: left.variants!.pial! };
    expect(() => validateSceneManifest(manifest)).toThrow(SceneManifestError);
  });

  it('requires every geometry to list the same names', async () => {
    const manifest = await withVariants();
    const right = manifest.geometries.right!;
    right.variants = { inflated: right.vertices, white: right.variants!.pial! };
    expect(() => validateSceneManifest(manifest)).toThrow(/same variant names/);
    delete right.variants;
    expect(() => validateSceneManifest(manifest)).toThrow(/must be present/);
  });

  it('rejects variants with the wrong role or shape', async () => {
    const manifest = await withVariants();
    const faces = manifest.geometries.left!.faces;
    manifest.geometries.left!.variants!.pial = faces;
    expect(() => validateSceneManifest(manifest)).toThrow(SceneManifestError);
  });
});

function box(id: string, hemisphere: 'left' | 'right', centerX: number, width: number) {
  const geometry = new THREE.BoxGeometry(width, 6, 4);
  geometry.translate(centerX, 0, 0);
  return { id, hemisphere, mesh: new THREE.Mesh(geometry, new THREE.MeshBasicMaterial()) } as const;
}

describe('relayoutReportMeshesInPlace', () => {
  it('re-separates an anatomical pair after the geometry grows, keeping its rotation', () => {
    const targets = [box('lh', 'left', -20, 4), box('rh', 'right', 20, 4)];
    layoutReportAnatomicalBrain(targets, 'dorsal', 8);
    const rotation = targets[0]!.mesh.quaternion.clone();
    // Inflate both hemispheres in place, as a variant switch does.
    for (const { mesh } of targets) {
      (mesh.geometry as THREE.BufferGeometry).scale(3, 1, 1);
    }
    relayoutReportMeshesInPlace(targets, 8, true);
    for (const { mesh } of targets) expect(mesh.quaternion.angleTo(rotation)).toBeLessThan(1e-9);
    const left = new THREE.Box3().setFromObject(targets[0]!.mesh, true);
    const right = new THREE.Box3().setFromObject(targets[1]!.mesh, true);
    // In the dorsal pose x stays lateral: the hemispheres do not overlap.
    expect(left.intersectsBox(right)).toBe(false);
    const gap = right.min.x - left.max.x;
    expect(gap).toBeCloseTo(8, 6);
  });
});
