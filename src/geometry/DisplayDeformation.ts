import type * as THREE from 'three';

/** A registered shader fragment evaluates exactly the positions used by CPU picking. */
export interface DisplayDeformation {
  declarations: string;
  positionExpression: string;
  uniforms: Record<string, THREE.IUniform>;
}
const deformations = new WeakMap<THREE.Mesh, DisplayDeformation>();
export function registerDisplayDeformation(mesh: THREE.Mesh, deformation: DisplayDeformation): () => void {
  if (deformations.has(mesh)) throw new Error('Mesh already has a display deformation');
  deformations.set(mesh, deformation);
  return () => { if (deformations.get(mesh) === deformation) deformations.delete(mesh); };
}
export function getDisplayDeformation(mesh: THREE.Mesh): DisplayDeformation | undefined { return deformations.get(mesh); }
