import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  chooseInformativeOblique,
  DEFAULT_REPORT_OBLIQUE,
  layoutReportAnatomicalBrain,
  layoutReportAnatomicalMeshes,
  REPORT_BRAIN_VIEWS,
  reportBrainViewAxes
} from '../../src/report/ReportSceneController';
import type {
  ReportAnatomicalMesh,
  ReportBrainView,
  ReportObliqueAngle
} from '../../src/report/ReportSceneController';
import { DataLayer, RGBALayer } from '../../src/layers';
import type { MultiLayerNeuroSurface } from '../../src/MultiLayerNeuroSurface';

/** A box hemisphere whose geometry (not mesh transform) carries its RAS placement. */
function hemisphereMesh(
  id: string,
  hemisphere: 'left' | 'right',
  centerX: number,
  size: readonly [number, number, number] = [2, 6, 4]
): ReportAnatomicalMesh & { mesh: THREE.Mesh } {
  const geometry = new THREE.BoxGeometry(...size);
  geometry.translate(centerX, 1, -0.5);
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
  // Deliberately stale transforms: the layout must reset them.
  mesh.position.set(5, -7, 3);
  mesh.quaternion.setFromEuler(new THREE.Euler(0.3, 0.2, 0.1));
  return { id, hemisphere, mesh };
}

function pair(): Array<ReportAnatomicalMesh & { mesh: THREE.Mesh }> {
  return [
    hemisphereMesh('lh', 'left', -30),
    hemisphereMesh('rh', 'right', 31, [4, 6, 4])
  ];
}

/** World bounds of a mesh expressed back in the brain's (un-rotated) RAS frame. */
function brainFrameBox(mesh: THREE.Mesh): THREE.Box3 {
  const inverse = mesh.quaternion.clone().invert();
  const geometry = (mesh.geometry as THREE.BufferGeometry).clone();
  geometry.applyMatrix4(mesh.matrixWorld);
  geometry.applyQuaternion(inverse);
  geometry.computeBoundingBox();
  return geometry.boundingBox!.clone();
}

function worldBox(mesh: THREE.Mesh): THREE.Box3 {
  return new THREE.Box3().setFromObject(mesh, true);
}

function vec(tuple: readonly [number, number, number]): THREE.Vector3 {
  return new THREE.Vector3(...tuple);
}

describe('reportBrainViewAxes', () => {
  it('exposes a frozen list of every whole-brain view', () => {
    expect(REPORT_BRAIN_VIEWS).toEqual([
      'left', 'right', 'left-medial', 'right-medial',
      'dorsal', 'ventral', 'anterior', 'posterior', 'oblique'
    ]);
    expect(Object.isFrozen(REPORT_BRAIN_VIEWS)).toBe(true);
    expect(Object.isFrozen(DEFAULT_REPORT_OBLIQUE)).toBe(true);
  });

  it.each(REPORT_BRAIN_VIEWS)('returns orthogonal unit axes for %s', view => {
    const axes = reportBrainViewAxes(view);
    expect(vec(axes.direction).length()).toBeCloseTo(1, 12);
    expect(vec(axes.up).length()).toBeCloseTo(1, 12);
    if (view !== 'oblique') {
      expect(Math.abs(vec(axes.direction).dot(vec(axes.up)))).toBeLessThan(1e-12);
    }
  });

  it('hides the contralateral hemisphere only in medial views', () => {
    expect(reportBrainViewAxes('left-medial')).toMatchObject({ direction: [1, 0, 0], hide: 'right' });
    expect(reportBrainViewAxes('right-medial')).toMatchObject({ direction: [-1, 0, 0], hide: 'left' });
    for (const view of REPORT_BRAIN_VIEWS) {
      if (view.endsWith('-medial')) continue;
      expect(reportBrainViewAxes(view).hide).toBeUndefined();
    }
  });

  it('places the camera at the requested oblique azimuth and elevation', () => {
    const cases: Array<[ReportObliqueAngle, [number, number, number]]> = [
      [{ azimuth: 0, elevation: 0 }, [0, 1, 0]],
      [{ azimuth: 90, elevation: 0 }, [1, 0, 0]],
      [{ azimuth: -90, elevation: 0 }, [-1, 0, 0]],
      [{ azimuth: 180, elevation: 0 }, [0, -1, 0]],
      [{ azimuth: 45, elevation: 30 }, [
        Math.sin(Math.PI / 4) * Math.cos(Math.PI / 6),
        Math.cos(Math.PI / 4) * Math.cos(Math.PI / 6),
        0.5
      ]]
    ];
    for (const [angle, expected] of cases) {
      const direction = vec(reportBrainViewAxes('oblique', angle).direction);
      expect(direction.distanceTo(vec(expected))).toBeLessThan(1e-12);
    }
    // The default oblique looks from the upper left-posterior quadrant.
    const fallback = vec(reportBrainViewAxes('oblique').direction);
    expect(fallback.x).toBeLessThan(0);
    expect(fallback.y).toBeLessThan(0);
    expect(fallback.z).toBeGreaterThan(0);
  });
});

describe('layoutReportAnatomicalBrain', () => {
  it.each(REPORT_BRAIN_VIEWS)(
    'keeps RAS placement, a midline gap of exactly the requested width, and one rigid rotation (%s)',
    view => {
      const targets = pair();
      const gap = 4;
      layoutReportAnatomicalBrain(targets, view, gap);
      const [left, right] = targets;

      // One rigid rotation for the whole brain.
      expect(left!.mesh.quaternion.toArray()).toEqual(right!.mesh.quaternion.toArray());

      // The requested view axis faces the camera (+z), with RAS up on screen.
      const axes = reportBrainViewAxes(view);
      const forward = vec(axes.direction).applyQuaternion(left!.mesh.quaternion);
      const up = vec(axes.up).applyQuaternion(left!.mesh.quaternion);
      expect(forward.distanceTo(new THREE.Vector3(0, 0, 1))).toBeLessThan(1e-10);
      if (view !== 'oblique') {
        expect(up.distanceTo(new THREE.Vector3(0, 1, 0))).toBeLessThan(1e-10);
      } else {
        // Screen-up is the projection of superior onto the image plane.
        expect(up.y).toBeGreaterThan(0);
        expect(Math.abs(up.x)).toBeLessThan(1e-10);
      }

      // In the brain frame: left stays left, right stays right, separated by gap.
      const leftBox = brainFrameBox(left!.mesh);
      const rightBox = brainFrameBox(right!.mesh);
      expect(rightBox.min.x - leftBox.max.x).toBeCloseTo(gap, 5);
      // Non-lateral coordinates keep their RAS placement (no re-centering per hemisphere).
      expect(leftBox.min.y - rightBox.min.y).toBeCloseTo(0, 5);
      expect(leftBox.min.z - rightBox.min.z).toBeCloseTo(0, 5);

      // The pair is centred on the origin, the orbit pivot.
      const combined = worldBox(left!.mesh).union(worldBox(right!.mesh));
      expect(combined.getCenter(new THREE.Vector3()).length()).toBeLessThan(1e-5);
    }
  );

  it('is identity-rotated in the dorsal view, so the world gap is the requested gap', () => {
    const targets = pair();
    layoutReportAnatomicalBrain(targets, 'dorsal', 6);
    const leftBox = worldBox(targets[0]!.mesh);
    const rightBox = worldBox(targets[1]!.mesh);
    expect(targets[0]!.mesh.quaternion.angleTo(new THREE.Quaternion())).toBeLessThan(1e-10);
    expect(rightBox.min.x - leftBox.max.x).toBeCloseTo(6, 10);
    expect(leftBox.max.x).toBeLessThan(0);
    expect(rightBox.min.x).toBeGreaterThan(0);
  });

  it('allows a zero gap so the hemispheres meet at the midline', () => {
    const targets = pair();
    layoutReportAnatomicalBrain(targets, 'dorsal', 0);
    expect(worldBox(targets[1]!.mesh).min.x - worldBox(targets[0]!.mesh).max.x).toBeCloseTo(0, 10);
  });

  it('hides the contralateral hemisphere in medial views and restores it afterwards', () => {
    const targets = pair();
    layoutReportAnatomicalBrain(targets, 'left-medial', 4);
    expect(targets.map(target => target.mesh.visible)).toEqual([true, false]);
    // The left hemisphere's medial (+x) face points at the camera.
    expect(new THREE.Vector3(1, 0, 0).applyQuaternion(targets[0]!.mesh.quaternion)
      .distanceTo(new THREE.Vector3(0, 0, 1))).toBeLessThan(1e-10);

    layoutReportAnatomicalBrain(targets, 'right-medial', 4);
    expect(targets.map(target => target.mesh.visible)).toEqual([false, true]);

    layoutReportAnatomicalBrain(targets, 'anterior', 4);
    expect(targets.map(target => target.mesh.visible)).toEqual([true, true]);
  });

  it('lets the split layout restore meshes hidden by a medial brain view', () => {
    const targets = pair();
    layoutReportAnatomicalBrain(targets, 'right-medial', 4);
    expect(targets[0]!.mesh.visible).toBe(false);
    layoutReportAnatomicalMeshes(targets, 'medial', 4, true);
    expect(targets.map(target => target.mesh.visible)).toEqual([true, true]);
  });

  it('centres a single hemisphere without a lateral offset', () => {
    const [only] = pair();
    layoutReportAnatomicalBrain([only!], 'left', 10);
    expect(worldBox(only!.mesh).getCenter(new THREE.Vector3()).length()).toBeLessThan(1e-5);
    expect(only!.mesh.visible).toBe(true);
  });

  it('honours an explicit oblique angle', () => {
    const targets = pair();
    const angle = { azimuth: 60, elevation: 20 };
    layoutReportAnatomicalBrain(targets, 'oblique', 4, angle);
    const forward = vec(reportBrainViewAxes('oblique', angle).direction)
      .applyQuaternion(targets[0]!.mesh.quaternion);
    expect(forward.distanceTo(new THREE.Vector3(0, 0, 1))).toBeLessThan(1e-10);
  });

  it.each([-1, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects hemisphereGap %s before touching any mesh',
    gap => {
      const targets = pair();
      const before = targets.map(target => target.mesh.position.clone());
      expect(() => layoutReportAnatomicalBrain(targets, 'left', gap)).toThrow(RangeError);
      targets.forEach((target, index) => {
        expect(target.mesh.position.equals(before[index]!)).toBe(true);
      });
    }
  );

  it('does nothing for an empty target list', () => {
    expect(() => layoutReportAnatomicalBrain([], 'oblique' as ReportBrainView, 4)).not.toThrow();
  });
});

/** A normals-only surface: chooseInformativeOblique reads only mesh normals. */
function normalsSurface(normals: ReadonlyArray<readonly [number, number, number]>): MultiLayerNeuroSurface {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(
    normals.flatMap(normal => vec(normal).normalize().toArray()),
    3
  ));
  return { mesh: new THREE.Mesh(geometry) } as unknown as MultiLayerNeuroSurface;
}

function thresholdedLayer(values: number[], threshold: [number, number] = [-1, 1]): DataLayer {
  return new DataLayer('map', values, null, 'viridis', { range: [-5, 5], threshold });
}

const FALLBACK: ReportObliqueAngle = Object.freeze({ azimuth: -124, elevation: 41 });

function expectNonCanonical(angle: ReportObliqueAngle): void {
  for (const canonical of [-180, -90, 0, 90, 180]) {
    expect(Math.abs(angle.azimuth - canonical)).toBeGreaterThanOrEqual(25);
  }
  expect(angle.elevation).toBeGreaterThanOrEqual(0);
  expect(angle.elevation).toBeLessThanOrEqual(40);
}

describe('chooseInformativeOblique', () => {
  const normals: Array<[number, number, number]> = [
    [-1, -1, 0.2], // left-posterior
    [1, 1, 0.2],   // right-anterior
    [0, 0, -1],    // inferior
    [-1, 1, 0]     // left-anterior
  ];

  it('returns the fallback unchanged when no vertex survives the threshold', () => {
    const surface = normalsSurface(normals);
    // Threshold inactive.
    expect(chooseInformativeOblique(
      [{ hemisphere: 'left', surface, layer: thresholdedLayer([3, 3, 3, 3], [0, 0]) }],
      FALLBACK
    )).toBe(FALLBACK);
    // Threshold active but every value masked.
    expect(chooseInformativeOblique(
      [{ hemisphere: 'left', surface, layer: thresholdedLayer([0, 0.5, -0.5, 1]) }],
      FALLBACK
    )).toBe(FALLBACK);
    // Non-data layers, missing meshes and no targets are ignored.
    expect(chooseInformativeOblique(
      [{ hemisphere: 'left', surface, layer: new RGBALayer('rgba', new Float32Array(16)) }],
      FALLBACK
    )).toBe(FALLBACK);
    expect(chooseInformativeOblique(
      [{ hemisphere: 'left', surface: {} as MultiLayerNeuroSurface, layer: thresholdedLayer([3, 3, 3, 3]) }],
      FALLBACK
    )).toBe(FALLBACK);
    expect(chooseInformativeOblique([], FALLBACK)).toBe(FALLBACK);
  });

  it('turns toward the side the suprathreshold cortex faces (left-posterior)', () => {
    const angle = chooseInformativeOblique(
      [{ hemisphere: 'left', surface: normalsSurface(normals), layer: thresholdedLayer([4, 0, 0, 0]) }],
      FALLBACK
    );
    expect(angle).not.toBe(FALLBACK);
    expect(Object.isFrozen(angle)).toBe(true);
    expect(angle.azimuth).toBeGreaterThan(-180);
    expect(angle.azimuth).toBeLessThan(-90);
    expectNonCanonical(angle);
  });

  it('turns toward the side the suprathreshold cortex faces (right-anterior)', () => {
    const angle = chooseInformativeOblique(
      [{ hemisphere: 'right', surface: normalsSurface(normals), layer: thresholdedLayer([0, -4, 0, 0]) }],
      FALLBACK
    );
    expect(angle.azimuth).toBeGreaterThan(0);
    expect(angle.azimuth).toBeLessThan(90);
    expectNonCanonical(angle);
  });

  it('keeps elevation within 0..40 even for dorsal or ventral clusters', () => {
    const dorsal = chooseInformativeOblique(
      [{ hemisphere: 'left', surface: normalsSurface([[0, 0, 1]]), layer: thresholdedLayer([4]) }],
      FALLBACK
    );
    expect(dorsal.elevation).toBe(40);
    expectNonCanonical(dorsal);

    const ventral = chooseInformativeOblique(
      [{ hemisphere: 'left', surface: normalsSurface([[-1, 0, -3]]), layer: thresholdedLayer([4]) }],
      FALLBACK
    );
    expectNonCanonical(ventral);
    expect(ventral.azimuth).toBeLessThan(0);
  });

  it('discounts medial-wall-facing vertices hidden by the other hemisphere', () => {
    // Left hemisphere: one strong medial (+x, anterior) cluster vs. a weaker
    // lateral-posterior one. Without the medial discount the medial side wins.
    const surface = normalsSurface([[1, 0.4, 0], [-1, -0.6, 0]]);
    const angle = chooseInformativeOblique(
      [{ hemisphere: 'left', surface, layer: thresholdedLayer([4, 2.5]) }],
      FALLBACK
    );
    expect(angle.azimuth).toBeLessThan(0);
  });

  it('pools both hemispheres and honours sparse layers', () => {
    const left = normalsSurface([[-1, -1, 0], [0, 0, 1]]);
    const right = normalsSurface([[1, -1, 0], [0, 0, 1]]);
    const sparse = new DataLayer('map', [4], [0], 'viridis', { range: [-5, 5], threshold: [-1, 1] });
    const angle = chooseInformativeOblique(
      [
        { hemisphere: 'left', surface: left, layer: sparse },
        { hemisphere: 'right', surface: right, layer: thresholdedLayer([0, 0]) }
      ],
      FALLBACK
    );
    // Only the left-posterior sparse vertex is suprathreshold.
    expect(angle.azimuth).toBeLessThan(-90);
    expectNonCanonical(angle);
  });
});
