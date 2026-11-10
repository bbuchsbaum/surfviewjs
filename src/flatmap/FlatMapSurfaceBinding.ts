import * as THREE from 'three';
import { NeuroSurface, SurfaceGeometry } from '../classes';
import { SurfaceMetric } from '../geometry/SurfaceDomain';
import { GeometryError, checkBudget } from '../geometry/GeometryError';
import { ReliefDisplayBinding, RELIEF_POSITION_GLSL } from '../relief/ReliefDisplayBinding';
import { SurfaceRelief } from '../relief/SurfaceRelief';
import { FlatMapChart, chartStorage } from './FlatMapChart';
import { FlatMapField } from './FlatMapFieldMaterial';
import { FLATMAP_COLOR_GLSL } from './FlatMapPresentation';

export interface FlatMapSurfaceOptions {
  relief?: SurfaceRelief;
  /** Display calibration only. Anatomical measurements retain their original coordinates. */
  mmPerUnit?: number;
  budgetBytes?: number;
}

/** Opt-in scalar-before-LUT surface. The caller owns the shared field and anatomical inputs. */
export class FlatMapSurfaceBinding extends NeuroSurface {
  readonly display: ReliefDisplayBinding;
  readonly byteLength: number;
  private readonly shading = { value: false };
  private readonly roi = { value: false };
  private disposed = false;
  private readonly detachField: () => void;

  constructor(readonly chart: FlatMapChart, metric: SurfaceMetric, readonly field: FlatMapField, options: FlatMapSurfaceOptions = {}) {
    if (metric.domain !== chart.domain || (options.relief && options.relief.chart !== chart)) throw new GeometryError('invalid-domain', 'Surface inputs must share a chart/domain');
    const scale = options.mmPerUnit ?? options.relief?.mmPerUnit ?? chart.mmPerUnit;
    if (scale === undefined || !Number.isFinite(scale) || scale <= 0) throw new GeometryError('frame-mismatch', 'Explicit chart calibration required');
    if ((chart.units === 'mm' && scale !== 1) || (options.relief && options.relief.mmPerUnit !== scale)) throw new GeometryError('frame-mismatch', 'Display and relief calibration differ');
    const c = chartStorage(chart), n = chart.vertexCount;
    // Includes retained CPU arrays and an estimate of expanded GPU face-pick geometry.
    checkBudget(n * 136 + chart.faceCount * 3 * 60, options.budgetBytes);
    const vertices = new Float32Array(n * 3), positions = metric.copyPositions();
    for (let v = 0; v < n; v++) vertices.set(positions.subarray(c.vertices[v]! * 3, c.vertices[v]! * 3 + 3), v * 3);
    super(new SurfaceGeometry(vertices, c.faces.slice(), chart.domain.structure, null, false), null, new Float32Array(n));
    const flat = new Float32Array(n * 3), uv = new Float32Array(n * 2), relief = options.relief?.copyDisplayAttributes() ?? new Float32Array(n * 3);
    const [x0, y0, x1, y1] = chart.bounds;
    for (let v = 0; v < n; v++) {
      flat[v * 3] = (c.xy[v * 2]! - (x0 + x1) / 2) * scale;
      flat[v * 3 + 1] = (c.xy[v * 2 + 1]! - (y0 + y1) / 2) * scale;
      relief[v * 3]! *= scale;
      uv[v * 2] = c.xy[v * 2]!; uv[v * 2 + 1] = c.xy[v * 2 + 1]!;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3)); geometry.setIndex(new THREE.BufferAttribute(c.faces.slice(), 1));
    geometry.setAttribute('chartPosition', new THREE.BufferAttribute(flat, 3));
    geometry.setAttribute('reliefData', new THREE.BufferAttribute(relief, 3));
    geometry.setAttribute('chartCoordinate', new THREE.BufferAttribute(uv, 2));
    geometry.setAttribute('roiMask', new THREE.BufferAttribute(new Float32Array(n), 1));
    geometry.computeVertexNormals();
    const material = new THREE.ShaderMaterial({ side: THREE.DoubleSide, toneMapped: false, clipping: true,
      uniforms: { ...field.uniforms, uShading: this.shading, uRoi: this.roi },
      vertexShader: `${RELIEF_POSITION_GLSL}
        #include <clipping_planes_pars_vertex>
        attribute vec2 chartCoordinate; attribute float roiMask;
        varying vec2 vCoordinate; varying vec3 vNormal; varying float vRoi;
        void main(){
          vCoordinate=chartCoordinate; vRoi=roiMask;
          vec3 flatNormal=normalize(vec3(-reliefData.y*uExaggeration,-reliefData.z*uExaggeration,1.));
          vNormal=normalize(normalMatrix*mix(normal,flatNormal,uFold));
          vec4 mvPosition=modelViewMatrix*vec4(reliefPosition(),1.);
          gl_Position=projectionMatrix*mvPosition;
          #include <clipping_planes_vertex>
        }`,
      fragmentShader: `${FLATMAP_COLOR_GLSL}
        #include <clipping_planes_pars_fragment>
        varying vec2 vCoordinate; varying vec3 vNormal; varying float vRoi;
        uniform vec4 uBounds; uniform bool uShading; uniform bool uRoi;
        void main(){
          #include <clipping_planes_fragment>
          vec2 uv=vec2((vCoordinate.x-uBounds.x)/(uBounds.z-uBounds.x),(uBounds.w-vCoordinate.y)/(uBounds.w-uBounds.y));
          vec4 color=flatMapColor(uv,1.);
          if(uShading) color.rgb*=.48+.52*abs(dot(normalize(vNormal),normalize(vec3(-.35,.5,1.))));
          if(uRoi && vRoi>.5) color.rgb=mix(color.rgb,vec3(.949,.761,.188),.72);
          gl_FragColor=color;
        }` });
    this.mesh = new THREE.Mesh(geometry, material);
    // Shared field uniforms can be consumed by independent renderer contexts.
    // Refresh sampler bindings even when Three reuses the same shader program.
    this.mesh.onBeforeRender = () => { material.uniformsNeedUpdate = true; };
    this.display = new ReliefDisplayBinding(chart, this.mesh);
    Object.assign(material.uniforms, this.display.uniforms);
    this.byteLength = n * 112 + c.faces.byteLength;
    this.detachField = field.on('change', () => this.updateColors());
  }
  createMesh(): THREE.Mesh { if (!this.mesh) throw new GeometryError('disposed', 'Surface unavailable'); return this.mesh; }
  updateColors(): void { this.emit('render:needed', { surface: this }); }
  setDeformation(fold: number, exaggeration = 0, shading = false): void {
    this.display.setDeformation(fold, exaggeration); this.shading.value = shading; this.updateColors();
  }
  /** Anatomical vertex mask; seam copies receive the same ROI membership. */
  setROI(mask: ArrayLike<number> | null): void {
    if (mask && mask.length !== this.chart.domain.vertexCount) throw new GeometryError('invalid-shape', 'ROI mask differs from anatomy');
    const attribute = this.mesh!.geometry.getAttribute('roiMask') as THREE.BufferAttribute, c = chartStorage(this.chart);
    for (let v = 0; v < c.vertices.length; v++) attribute.setX(v, mask?.[c.vertices[v]!] ? 1 : 0);
    attribute.needsUpdate = true; this.roi.value = mask !== null; this.updateColors();
  }
  dispose(): void { if (!this.disposed) { this.disposed = true; this.detachField(); this.display.dispose(); super.dispose(); } }
}
