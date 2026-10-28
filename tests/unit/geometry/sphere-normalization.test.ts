import { describe, expect, it } from 'vitest';
import { SurfaceDomain, SurfaceMetric } from '../../../src/geometry/SurfaceDomain';
import { buildSurfaceResamplingPlan, exportSurfaceResamplingPlan, importSurfaceResamplingPlan } from '../../../src/geometry/SurfaceResampling';

describe('explicit sphere normalization', () => {
  const domain = new SurfaceDomain({ id: 'sphere-face', structure: 'left', vertexCount: 3, faces: [0, 1, 2] });
  const base = new SurfaceMetric(domain, { positions: [1, 0, 0, 0, 1, 0, 0, 0, 1], frame: 'registered', units: 'mm' });
  const perturbed = new SurfaceMetric(domain, { positions: [1.0005, 0, 0, 0, 0.9995, 0, 0, 0, 1.0002], frame: 'registered', units: 'mm' });
  const target = new SurfaceMetric(domain, { positions: [0.6, 0.8, 0, 0, 0.6, 0.8, 0.8, 0, 0.6], frame: 'registered', units: 'mm' });
  const registration = { id: 'known', frame: 'registered', center: [0, 0, 0] as const, radiusMm: 1 };
  it('removes radial perturbations only when explicitly requested', () => {
    const raw = buildSurfaceResamplingPlan({ source: perturbed, target, registration });
    const normalized = buildSurfaceResamplingPlan({ source: perturbed, target, registration }, { sphereNormalization: 'radius' });
    const exact = buildSurfaceResamplingPlan({ source: base, target, registration });
    const values = [0, 2, 7];
    expect([...normalized.apply(values).values]).toEqual([...exact.apply(values).values]);
    expect([...raw.apply(values).values]).not.toEqual([...exact.apply(values).values]);
    expect(raw.provenance.sphereNormalization).toBeUndefined();
    expect([...perturbed.copyPositions()]).toEqual([1.0005, 0, 0, 0, 0.9995, 0, 0, 0, 1.0002]);
  });
  it('round-trips normalization policy, center and radius', async () => {
    const plan = buildSurfaceResamplingPlan({ source: perturbed, target, registration }, { sphereNormalization: 'radius' });
    const restored = await importSurfaceResamplingPlan(await exportSurfaceResamplingPlan(plan), domain, domain);
    expect(restored.provenance.sphereNormalization).toEqual({ policy: 'radius', center: [0, 0, 0], radiusMm: 1 });
    expect(Object.isFrozen(plan.provenance.sphereNormalization!.center)).toBe(true);
    expect(restored.apply([0, 2, 7])).toEqual(plan.apply([0, 2, 7]));
  });
});
