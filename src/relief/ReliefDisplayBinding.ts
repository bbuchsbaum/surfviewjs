import * as THREE from 'three';
import { FlatMapChart, chartStorage } from '../flatmap/FlatMapChart';
import { GeometryError, checkFraction, checkFinite, checkIndex } from '../geometry/GeometryError';
import { registerDisplayBinding, type DisplayBinding } from '../geometry/DisplayGeometryBinding';
import { registerDisplayDeformation } from '../geometry/DisplayDeformation';
import type { SurfaceLocation } from '../geometry/SurfaceLocation';

/** Shared verbatim by the visible material and GPU face-ID pass. */
export const RELIEF_POSITION_GLSL = `
attribute vec3 chartPosition;
attribute vec3 reliefData;
uniform float uFold;
uniform float uExaggeration;
vec3 reliefPosition() {
  return mix(position, chartPosition, uFold) + vec3(0., 0., reliefData.x * uFold * uExaggeration);
}
`;

/** CPU proxy and anatomical identity for one cut display mesh. Does not alter anatomical metrics. */
export class ReliefDisplayBinding implements DisplayBinding {
  readonly domain;
  readonly uniforms = { uFold: { value: 0 }, uExaggeration: { value: 0 } };
  private generation = 0;
  private disposed = false;
  private readonly proxy: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  private readonly evaluated: THREE.BufferAttribute;
  private readonly unregister: Array<() => void>;
  private readonly originalRaycast: THREE.Mesh['raycast'];
  private readonly originalVertex: THREE.Mesh['getVertexPosition'];
  readonly byteLength: number;

  constructor(readonly chart: FlatMapChart, readonly mesh: THREE.Mesh) {
    this.domain = chart.domain;
    const c = chartStorage(chart), g = mesh.geometry, index = g.getIndex();
    for (const attribute of ['position', 'chartPosition', 'reliefData']) {
      if (g.getAttribute(attribute)?.count !== chart.vertexCount) throw new GeometryError('invalid-shape', `Missing ${attribute}`);
    }
    if (!index || index.count !== c.faces.length || c.faces.some((v, i) => index.getX(i) !== v)) throw new GeometryError('invalid-domain', 'Display faces differ from chart');
    this.evaluated = new THREE.BufferAttribute(new Float32Array(chart.vertexCount * 3), 3);
    const proxyGeometry = new THREE.BufferGeometry();
    proxyGeometry.setAttribute('position', this.evaluated); proxyGeometry.setIndex(index);
    this.proxy = new THREE.Mesh(proxyGeometry, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
    this.proxy.matrixAutoUpdate = false;
    this.byteLength = this.evaluated.array.byteLength;
    this.originalRaycast = mesh.raycast; this.originalVertex = mesh.getVertexPosition;
    mesh.getVertexPosition = (vertex, out) => out.fromBufferAttribute(this.evaluated, vertex);
    mesh.raycast = (raycaster, intersections) => {
      this.proxy.matrixWorld.copy(mesh.matrixWorld);
      const hits: THREE.Intersection[] = []; this.proxy.raycast(raycaster, hits);
      for (const hit of hits) { hit.object = mesh; intersections.push(hit); }
    };
    this.unregister = [registerDisplayBinding(mesh, this), registerDisplayDeformation(mesh, {
      declarations: RELIEF_POSITION_GLSL, positionExpression: 'reliefPosition()', uniforms: this.uniforms
    })];
    this.setDeformation(0, 0);
  }
  get revision(): string { return String(this.generation); }
  get state(): Readonly<{ fold: number; exaggeration: number }> { return { fold: this.uniforms.uFold.value, exaggeration: this.uniforms.uExaggeration.value }; }
  setDeformation(fold: number, exaggeration: number): void {
    if (this.disposed) throw new GeometryError('disposed', 'Display binding disposed');
    checkFraction(fold, 'fold'); checkFinite(exaggeration, 'exaggeration', 0);
    if (exaggeration > 20) throw new GeometryError('invalid-shape', 'Exaggeration must not exceed 20');
    const g = this.mesh.geometry, base = g.getAttribute('position'), flat = g.getAttribute('chartPosition'), relief = g.getAttribute('reliefData');
    // One synchronous commit: CPU hits and GPU uniforms cannot expose different revisions.
    for (let v = 0; v < this.chart.vertexCount; v++) {
      this.evaluated.setXYZ(v, base.getX(v) * (1 - fold) + flat.getX(v) * fold,
        base.getY(v) * (1 - fold) + flat.getY(v) * fold,
        base.getZ(v) * (1 - fold) + flat.getZ(v) * fold + relief.getX(v) * fold * exaggeration);
    }
    this.evaluated.needsUpdate = true;
    this.proxy.geometry.computeBoundingBox(); this.proxy.geometry.computeBoundingSphere();
    g.boundingBox = this.proxy.geometry.boundingBox!.clone(); g.boundingSphere = this.proxy.geometry.boundingSphere!.clone();
    this.uniforms.uFold.value = fold; this.uniforms.uExaggeration.value = exaggeration; this.generation++;
  }
  incidentFaces(vertex: number): number[] {
    return Array.from(this.domain.topology.incidentFaces(vertex)).filter(face => chartStorage(this.chart).inverseFaces[face]! >= 0);
  }
  anatomicalVertex(vertex: number): number { checkIndex(vertex, this.chart.vertexCount, 'display vertex'); return chartStorage(this.chart).vertices[vertex]!; }
  position(vertex: number, out = new Float64Array(3), face?: number): Float64Array {
    checkIndex(vertex, this.domain.vertexCount, 'vertex');
    if (out.length !== 3) throw new GeometryError('invalid-shape', 'Position output requires three values');
    const c = chartStorage(this.chart);
    let display = c.vertexCopies[c.vertexOffsets[vertex]!] ?? -1;
    if (face !== undefined) {
      checkIndex(face, this.domain.faceCount, 'face'); const f = c.inverseFaces[face]!;
      if (f < 0) throw new GeometryError('invalid-domain', 'Anatomical face is outside this chart');
      display = -1;
      for (let k = 0; k < 3; k++) { const v = c.faces[f * 3 + k]!; if (c.vertices[v] === vertex) display = v; }
    } else if (c.vertexOffsets[vertex] === c.vertexOffsets[vertex + 1]) display = -1;
    if (display < 0) throw new GeometryError('invalid-domain', 'Anatomical vertex is outside this chart face');
    out[0] = this.evaluated.getX(display); out[1] = this.evaluated.getY(display); out[2] = this.evaluated.getZ(display); return out;
  }
  locationAt(face: number, worldPoint: THREE.Vector3): SurfaceLocation {
    checkIndex(face, this.chart.faceCount, 'display face'); this.mesh.updateWorldMatrix(true, false);
    const c = chartStorage(this.chart), triangle = [0, 1, 2].map(k => new THREE.Vector3().fromBufferAttribute(this.evaluated, c.faces[face * 3 + k]!));
    const weights = new THREE.Triangle(triangle[0]!, triangle[1]!, triangle[2]!).getBarycoord(this.mesh.worldToLocal(worldPoint.clone()), new THREE.Vector3());
    if (!weights) throw new GeometryError('degenerate-geometry', 'Collapsed display triangle');
    // Raycast arithmetic is float32; remove only tiny edge round-off, then normalize.
    const w = weights.toArray().map(x => x > -1e-5 ? Math.max(0, x) : x), sum = w.reduce((a, b) => a + b, 0);
    return this.chart.location(face, [w[0]! / sum, w[1]! / sum, w[2]! / sum]);
  }
  clearCache(): void { /* Positions are a bounded dense proxy, updated only with deformation. */ }
  dispose(): void {
    if (this.disposed) return; this.disposed = true;
    for (const off of this.unregister) off();
    this.mesh.raycast = this.originalRaycast; this.mesh.getVertexPosition = this.originalVertex;
    this.proxy.geometry.dispose(); this.proxy.material.dispose();
    this.mesh.geometry.computeBoundingBox(); this.mesh.geometry.computeBoundingSphere();
  }
}
