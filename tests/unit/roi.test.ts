import { describe, expect, it } from 'vitest';
import {
  ROIManager,
  RoiPoint,
  roiToLabelArray,
  roiToLabelGIFTI,
  roiToSubjectPackageRoi,
  roiToSVG,
  selectVerticesInPolygon
} from '../../src/roi';

const source = {
  vertexCount: 5,
  projectVertex(vertexIndex: number): RoiPoint {
    return [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
      { x: 5, y: 5 }
    ][vertexIndex];
  }
};

describe('ROI vertex selection and export', () => {
  it('selects vertices inside or on a polygon boundary', () => {
    const polygon = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 }
    ];

    expect(selectVerticesInPolygon(source, polygon)).toEqual([0, 1, 2, 3, 4]);
  });

  it('stores normalized vertex sets with provenance', () => {
    const manager = new ROIManager();
    const roi = manager.create({
      name: 'V1_candidate',
      surfaceId: 'lh',
      vertexIndices: [4, 1, 1, 3],
      color: '#ffcc00',
      provenance: { sourceLayer: 'retinotopy.angle', tool: 'polygon' }
    });

    expect(roi.vertexIndices).toEqual([1, 3, 4]);
    expect(manager.get(roi.id)?.provenance?.sourceLayer).toBe('retinotopy.angle');

    const updated = manager.update(roi.id, { vertexIndices: [2, 0], name: 'V1_reviewed' });
    expect(updated?.name).toBe('V1_reviewed');
    expect(updated?.vertexIndices).toEqual([0, 2]);
  });

  it('exports label arrays, SVG outlines, and GIFTI-style labels', () => {
    const manager = new ROIManager();
    const roi = manager.create({
      id: 'roi-v1',
      name: 'V1 & V2',
      surfaceId: 'lh',
      vertexIndices: [0, 2],
      outline: [
        { x: 1, y: 1 },
        { x: 9, y: 1 },
        { x: 9, y: 9 }
      ]
    });

    expect(Array.from(roiToLabelArray(roi, { vertexCount: 4, labelValue: 7 }))).toEqual([7, 0, 7, 0]);
    expect(roiToSVG(roi, { width: 10, height: 10 })).toContain('data-vertices="0 2"');
    expect(roiToSVG(roi, { width: 10, height: 10 })).toContain('V1 &amp; V2');
    expect(roiToLabelGIFTI(roi, { vertexCount: 4 })).toContain('<Data>1 0 1 0</Data>');
    expect(roiToSubjectPackageRoi(roi, {
      vertexCount: 4,
      file: 'rois/lh.v1.label.gii',
      hemisphere: 'left'
    })).toMatchObject({
      id: 'roi-v1',
      file: 'rois/lh.v1.label.gii',
      surface: 'lh',
      vertexCount: 4,
      vertexIndices: [0, 2],
      hemisphere: 'left',
      provenance: { roiName: 'V1 & V2' }
    });
  });
});
