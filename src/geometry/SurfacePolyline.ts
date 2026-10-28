import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { evaluateSurfaceStrokePoint, type SurfaceLocation, type SurfacePositionBinding } from './SurfaceLocation';

/** Screen-space surface stroke with depth occlusion and shared-edge display offsets. */
export class SurfacePolyline extends LineSegments2 {
  constructor(readonly locations: readonly SurfaceLocation[], readonly offset = 0.2, color = 0xf2c230, width = 2) {
    super(new LineSegmentsGeometry(), new LineMaterial({ color, linewidth: width, depthTest: true, depthWrite: false }));
  }
  updateBinding(binding: SurfacePositionBinding): void {
    const points = this.locations.map(location => evaluateSurfaceStrokePoint(location, binding, this.offset));
    const start = this.geometry.getAttribute('instanceStart'), end = this.geometry.getAttribute('instanceEnd');
    if (!start || start.count !== Math.max(0, points.length - 1)) this.geometry.setPositions(points.slice(1).flatMap((p, i) => [...points[i]!, ...p]));
    else for (let i = 0; i < start.count; i++) { start.setXYZ(i, points[i]![0]!, points[i]![1]!, points[i]![2]!); end.setXYZ(i, points[i + 1]![0]!, points[i + 1]![1]!, points[i + 1]![2]!); }
    if (start) { start.needsUpdate = true; end.needsUpdate = true; }
    this.geometry.computeBoundingBox(); this.geometry.computeBoundingSphere();
  }
  dispose(): void { this.removeFromParent(); this.geometry.dispose(); this.material.dispose(); }
}
