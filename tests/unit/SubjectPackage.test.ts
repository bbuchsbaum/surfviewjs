import { describe, expect, it } from 'vitest';
import {
  SubjectPackage,
  SubjectPackageManifest,
  validateSubjectPackageManifest
} from '../../src/SubjectPackage';

function makeManifest(): SubjectPackageManifest {
  return {
    schemaVersion: '1.0.0',
    id: 'sub-01',
    name: 'Subject 01',
    software: {
      surfview: '2.2.0',
      generator: 'test'
    },
    provenance: {
      sourceFiles: ['sub-01/surf/lh.pial', 'sub-01/func/zstat1.nii.gz']
    },
    surfaces: [
      {
        id: 'lh',
        hemisphere: 'left',
        defaultVariant: 'inflated',
        variants: [
          {
            name: 'pial',
            kind: 'pial',
            file: 'surfaces/lh.pial.surf.gii',
            vertexCount: 4,
            faceCount: 4,
            hemisphere: 'left'
          },
          {
            name: 'white',
            kind: 'white',
            file: 'surfaces/lh.white.surf.gii',
            vertexCount: 4,
            faceCount: 4,
            hemisphere: 'left'
          },
          {
            name: 'inflated',
            kind: 'inflated',
            file: 'surfaces/lh.inflated.surf.gii',
            vertexCount: 4,
            faceCount: 4,
            hemisphere: 'left'
          },
          {
            name: 'flat',
            kind: 'flat',
            file: 'surfaces/lh.flat.surf.gii',
            vertexCount: 4,
            faceCount: 4,
            hemisphere: 'left'
          }
        ]
      }
    ],
    metrics: [
      {
        id: 'lh-curv',
        kind: 'curvature',
        file: 'metrics/lh.curv.func.gii',
        surface: 'lh',
        vertexCount: 4,
        hemisphere: 'left'
      }
    ],
    parcellations: [
      {
        id: 'lh-labels',
        file: 'parcellations/lh.labels.gii',
        surface: 'lh',
        vertexCount: 4,
        labelCount: 2,
        hemisphere: 'left'
      }
    ],
    rois: [
      {
        id: 'lh-v1',
        file: 'rois/lh.rois.svg',
        surface: 'lh',
        vertexCount: 4,
        vertexIndices: [0, 2],
        hemisphere: 'left',
        provenance: { sourceFiles: ['retinotopy.angle'] }
      }
    ],
    transforms: [
      {
        id: 'anat-to-bold',
        from: 'anat',
        to: 'boldref',
        matrix: [
          1, 0, 0, 0,
          0, 1, 0, 0,
          0, 0, 1, 0,
          0, 0, 0, 1
        ]
      }
    ],
    volumes: [
      {
        id: 'zstat1',
        file: 'volumes/zstat1.nii.gz',
        dims: [2, 2, 2],
        transform: 'anat-to-bold',
        space: 'boldref'
      }
    ],
    scenes: [
      {
        id: 'default',
        surfaces: [
          { surface: 'lh', variant: 'inflated' }
        ],
        layers: [
          {
            id: 'curvature',
            source: { type: 'metric', id: 'lh-curv' },
            surface: 'lh',
            opacity: 1
          },
          {
            id: 'activation',
            source: { type: 'volume', id: 'zstat1' },
            surface: 'lh',
            transform: 'anat-to-bold',
            opacity: 0.85
          },
          {
            id: 'roi',
            source: { type: 'roi', id: 'lh-v1' },
            surface: 'lh'
          }
        ]
      }
    ],
    defaultScene: 'default'
  };
}

describe('SubjectPackage', () => {
  it('accepts a complete subject-level visualization manifest', () => {
    const manifest = makeManifest();
    const report = validateSubjectPackageManifest(manifest);

    expect(report.valid).toBe(true);
    expect(report.errors).toHaveLength(0);

    const subject = SubjectPackage.fromManifest(manifest);
    expect(subject.id).toBe('sub-01');
    expect(subject.getSurfaceVariant('lh')?.name).toBe('inflated');
    expect(subject.getSurfaceVariant('lh', 'flat')?.kind).toBe('flat');
    expect(subject.getMetric('lh-curv')?.kind).toBe('curvature');
    expect(subject.getTransform('anat-to-bold')?.to).toBe('boldref');
    expect(subject.getScene()?.id).toBe('default');
  });

  it('reports mismatched surface variant topology', () => {
    const manifest = makeManifest();
    manifest.surfaces[0].variants[1].vertexCount = 5;

    const report = validateSubjectPackageManifest(manifest);

    expect(report.valid).toBe(false);
    expect(report.errors.map(issue => issue.code)).toContain('surface-vertex-count-mismatch');
  });

  it('reports curvature or metric length mismatches', () => {
    const manifest = makeManifest();
    manifest.metrics![0].vertexCount = 5;

    const report = validateSubjectPackageManifest(manifest);

    expect(report.valid).toBe(false);
    expect(report.errors.map(issue => issue.code)).toContain('metric-vertex-count-mismatch');
  });

  it('reports ROI vertex references outside the surface vertex range', () => {
    const manifest = makeManifest();
    manifest.rois![0].vertexIndices = [0, 4];

    const report = validateSubjectPackageManifest(manifest);

    expect(report.valid).toBe(false);
    expect(report.errors.map(issue => issue.code)).toContain('roi-vertex-out-of-range');
  });

  it('reports invalid transform matrices', () => {
    const manifest = makeManifest();
    manifest.transforms![0].matrix = [1, 0, 0];

    const report = validateSubjectPackageManifest(manifest);

    expect(report.valid).toBe(false);
    expect(report.errors.map(issue => issue.code)).toContain('invalid-transform-matrix');
  });

  it('throws with a concise validation summary by default', () => {
    const manifest = makeManifest();
    manifest.defaultScene = 'missing';

    expect(() => SubjectPackage.fromManifest(manifest)).toThrow(
      /defaultScene: Default scene "missing"/
    );
  });

  it('can retain invalid manifests for diagnostic tooling when validation is disabled', () => {
    const manifest = makeManifest();
    manifest.defaultScene = 'missing';

    const subject = SubjectPackage.fromManifest(manifest, { validate: false });

    expect(subject.validation.valid).toBe(false);
    expect(subject.validation.errors.map(issue => issue.code)).toContain('unknown-default-scene');
  });
});
