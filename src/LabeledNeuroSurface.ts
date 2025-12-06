import * as THREE from 'three';
import { NeuroSurface, SurfaceGeometry, SurfaceConfig } from './classes';

export interface LabelDefinition {
  id: number;
  name: string;
  color: THREE.ColorRepresentation;
}

/**
 * Surface that renders categorical labels (parcellations / clusters) per vertex.
 * Each vertex holds an integer label id; a label table provides names and colors.
 */
export class LabeledNeuroSurface extends NeuroSurface {
  labels: Uint32Array;
  labelMap: Map<number, { name: string; color: THREE.Color } >;
  colors: Float32Array;

  constructor(
    geometry: SurfaceGeometry,
    indices: Uint32Array | number[] | null,
    labels: Uint32Array | number[],
    labelDefs: LabelDefinition[],
    config: SurfaceConfig = {}
  ) {
    // use labels as data for base class; still set a dummy data array
    const data = new Float32Array(geometry.vertices.length / 3);
    super(geometry, indices, data, config);
    this.labels = labels instanceof Uint32Array ? labels : new Uint32Array(labels);
    this.labelMap = new Map();
    labelDefs.forEach(def => {
      this.labelMap.set(def.id, { name: def.name, color: new THREE.Color(def.color as any) });
    });
    this.colors = new Float32Array((this.geometry.vertices.length / 3) * 3);
    this.createMesh();
    this.updateColors();
  }

  getLabelName(id: number): string | undefined {
    return this.labelMap.get(id)?.name;
  }

  setLabelColor(id: number, color: THREE.ColorRepresentation): void {
    const entry = this.labelMap.get(id);
    if (entry) {
      entry.color = new THREE.Color(color as any);
      this.updateColors();
    }
  }

  setLabels(labels: Uint32Array | number[]): void {
    this.labels = labels instanceof Uint32Array ? labels : new Uint32Array(labels);
    this.updateColors();
  }

  addOrUpdateLabel(def: LabelDefinition): void {
    this.labelMap.set(def.id, { name: def.name, color: new THREE.Color(def.color as any) });
    this.updateColors();
  }

  createMesh(): THREE.Mesh {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(this.geometry.vertices, 3));
    geometry.setIndex(new THREE.Uint32BufferAttribute(this.geometry.faces, 1));

    const material = new THREE.MeshPhongMaterial({
      vertexColors: true,
      transparent: this.config.alpha < 1,
      opacity: this.config.alpha,
      shininess: this.config.shininess || 30,
      specular: new THREE.Color(this.config.specularColor || 0x111111),
      emissive: new THREE.Color(this.config.emissive || 0x000000),
      emissiveIntensity: this.config.emissiveIntensity || 0,
      flatShading: this.config.flatShading || false,
      side: THREE.DoubleSide,
      depthWrite: this.config.alpha >= 1
    });

    this.mesh = new THREE.Mesh(geometry, material);
    this.computeNormals(geometry);
    return this.mesh;
  }

  updateColors(): void {
    if (!this.mesh) return;
    const geometry = this.mesh.geometry as THREE.BufferGeometry;
    const colorAttr = geometry.getAttribute('color') as THREE.BufferAttribute;
    const colors = this.colors;
    const labels = this.labels;
    const defaultColor = new THREE.Color(0x999999);

    for (let i = 0, v = 0; i < labels.length; i++, v += 3) {
      const entry = this.labelMap.get(labels[i]);
      const c = entry?.color || defaultColor;
      colors[v] = c.r;
      colors[v + 1] = c.g;
      colors[v + 2] = c.b;
    }

    if (colorAttr) {
      (colorAttr.array as Float32Array).set(colors);
      colorAttr.needsUpdate = true;
    } else {
      geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    }

    this.emit('layer:updated', { surface: this });
    this.emit('render:needed', { surface: this });
  }
}

export default LabeledNeuroSurface;
