import * as THREE from 'three';
import { SurfaceDomain, domainFaces } from './SurfaceDomain';
import { checkIndex, GeometryError } from './GeometryError';
import { triangleLocation, type SurfacePositionBinding, type SurfaceLocation } from './SurfaceLocation';

/** Reads the same morph-position formula as the renderer. A new binding is required after topology replacement. */
export class DisplayGeometryBinding implements SurfacePositionBinding {
  private geometry: THREE.BufferGeometry;
  private cache = new Map<number, Float64Array>();
  private revisionKey = '';
  private readonly point = new THREE.Vector3();
  private positionAttribute: THREE.BufferAttribute | THREE.InterleavedBufferAttribute;
  private indexAttribute: THREE.BufferAttribute;
  private indexVersion: number;
  private morphAttributes: (THREE.BufferAttribute | THREE.InterleavedBufferAttribute)[] = [];
  private morphGeneration = 0;
  constructor(readonly domain: SurfaceDomain, readonly mesh: THREE.Mesh) {
    this.geometry = mesh.geometry;
    const position = this.geometry.getAttribute('position'), indices = this.geometry.getIndex();
    const faces = domainFaces(domain);
    if (!position || position.count !== domain.vertexCount || !indices || indices.count !== faces.length) {
      throw new GeometryError('invalid-domain', 'Display geometry does not match domain');
    }
    for (let i = 0; i < faces.length; i++) if (indices.getX(i) !== faces[i]) throw new GeometryError('invalid-domain', `Display face differs at index ${i}`);
    this.positionAttribute = position; this.indexAttribute = indices; this.indexVersion = indices.version;
  }
  get revision(): string {
    const position = this.mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
    if (this.mesh.geometry !== this.geometry || position !== this.positionAttribute || this.geometry.getIndex() !== this.indexAttribute || this.indexAttribute.version !== this.indexVersion) throw new GeometryError('stale-input', 'Display geometry attributes were replaced or topology changed; rebind explicitly');
    const morphs = this.geometry.morphAttributes.position ?? [];
    if (morphs.length !== this.morphAttributes.length || morphs.some((attribute, i) => attribute !== this.morphAttributes[i])) {
      this.morphAttributes = [...morphs]; this.morphGeneration++;
    }
    const version = (attribute: THREE.BufferAttribute | THREE.InterleavedBufferAttribute) => 'isInterleavedBufferAttribute' in attribute ? attribute.data.version : attribute.version;
    return `${version(this.positionAttribute)}:${this.mesh.morphTargetInfluences?.join(',') ?? ''}:${Number(this.geometry.morphTargetsRelative)}:${this.morphGeneration}:${morphs.map(version).join(',')}`;
  }
  position(vertex: number, out = new Float64Array(3)): Float64Array {
    checkIndex(vertex, this.domain.vertexCount, 'vertex');
    if (out.length !== 3) throw new GeometryError('invalid-shape', 'Position output must have length three');
    if (this.mesh.geometry !== this.geometry) throw new GeometryError('stale-input', 'Display geometry was replaced');
    const key = this.revision;
    if (key !== this.revisionKey) { this.cache.clear(); this.revisionKey = key; }
    let point = this.cache.get(vertex);
    if (!point) {
      this.mesh.getVertexPosition(vertex, this.point);
      point = new Float64Array(this.point.toArray()); this.cache.set(vertex, point);
    }
    out.set(point); return out;
  }
  clearCache(): void { this.cache.clear(); }

  locationAt(face: number, worldPoint: THREE.Vector3): SurfaceLocation {
    this.mesh.updateWorldMatrix(true, false);
    const local = this.mesh.worldToLocal(worldPoint.clone());
    const ids = this.domain.triangle(face);
    const triangle = ids.map(id => new THREE.Vector3().fromArray(this.position(id)));
    const weights = new THREE.Triangle(triangle[0]!, triangle[1]!, triangle[2]!).getBarycoord(local, new THREE.Vector3());
    if (!weights) throw new GeometryError('degenerate-geometry', 'Cannot attach to degenerate display triangle');
    return triangleLocation(this.domain, face, weights.toArray());
  }
}

const bindings = new WeakMap<THREE.Mesh, DisplayGeometryBinding>();
/** Explicitly assert correspondence after checking every triangle index. */
export function bindSurfaceDomain(mesh: THREE.Mesh, domain: SurfaceDomain): DisplayGeometryBinding {
  const binding = new DisplayGeometryBinding(domain, mesh); bindings.set(mesh, binding); return binding;
}
/** Session-local identity by default; sharing a domain requires bindSurfaceDomain. */
export function getDisplayGeometryBinding(mesh: THREE.Mesh): DisplayGeometryBinding {
  let binding = bindings.get(mesh);
  if (!binding) {
    const index = mesh.geometry.getIndex(), position = mesh.geometry.getAttribute('position');
    if (!index || !position) throw new GeometryError('invalid-domain', 'Surface anchors require indexed triangle geometry');
    binding = bindSurfaceDomain(mesh, new SurfaceDomain({ id: mesh.uuid, structure: 'display', vertexCount: position.count, faces: index.array }));
  }
  return binding;
}
