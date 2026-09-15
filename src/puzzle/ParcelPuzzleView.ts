import * as THREE from 'three';
import { EventEmitter } from '../EventEmitter';
import { NeuroSurfaceViewer } from '../NeuroSurfaceViewer';
import type { ParcelRecord } from '../parcellation';
import type { ParcelPieceGeometry, ParcelPuzzleInput } from './buildParcelPuzzle';
import { ParcelPuzzle, type ParcelPuzzleOptions, type ParcelPuzzleSelection } from './ParcelPuzzle';
import { puzzleStyles } from './puzzleStyles';

export interface ParcelDetailContext {
  readonly parcel: Readonly<ParcelRecord>;
  readonly piece: ParcelPieceGeometry;
  /** Aborted before another selection, dismissal or disposal. Use for application data requests. */
  readonly signal: AbortSignal;
}

/** Mount application-owned content; optionally return its teardown function. */
export type ParcelDetailRenderer = (container: HTMLElement, context: ParcelDetailContext) => void | (() => void);

export interface ParcelPuzzleViewOptions extends ParcelPuzzleOptions {
  renderDetail?: ParcelDetailRenderer;
  /** Display label only; the original ParcelRecord and ID remain unchanged. */
  labelText?: (parcel: Readonly<ParcelRecord>) => string;
  /** Follow the system preference by default. */
  reducedMotion?: boolean;
  view?: 'lateral' | 'medial' | 'oblique';
}

export interface ParcelPuzzleViewEvents {
  'selection:changed': ParcelPuzzleSelection;
  'parcel:hover': ParcelPuzzleSelection;
  'detail:error': { parcelId: number; error: unknown };
}

interface Drag {
  pointer: number;
  x: number;
  y: number;
  distance: number;
  parcelId: number | null;
  rotate: boolean;
  controlsEnabled: boolean;
  target: HTMLElement;
}

/**
 * Mount a 3D cortical puzzle with stable hover, a floating selection and a rotatable
 * detail preview. Owns its viewers, event listeners and generated geometry.
 */
export class ParcelPuzzleView extends EventEmitter<ParcelPuzzleViewEvents> {
  readonly element: HTMLDivElement;
  readonly puzzle: ParcelPuzzle;
  readonly viewer: NeuroSurfaceViewer;
  private readonly stage: HTMLDivElement;
  private readonly detail: HTMLElement;
  private readonly content: HTMLDivElement;
  private readonly status: HTMLDivElement;
  private readonly selector: HTMLSelectElement;
  private readonly raycaster = new THREE.Raycaster();
  private readonly direction = new THREE.Vector3();
  private readonly options: ParcelPuzzleViewOptions;
  private readonly disposers: (() => void)[] = [];
  private readonly resizeObserver: ResizeObserver;
  private detailViewer: NeuroSurfaceViewer | null = null;
  private detailMesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial[]> | null = null;
  private detailAbort: AbortController | null = null;
  private detailCleanup: (() => void) | null = null;
  private detailDisposers: (() => void)[] = [];
  private drag: Drag | null = null;
  private lastFrame = 0;
  private disposed = false;
  private readonly media: MediaQueryList | null;

  constructor(container: HTMLElement, input: ParcelPuzzleInput, options: ParcelPuzzleViewOptions = {}) {
    super();
    if (options.view !== undefined && !['lateral', 'medial', 'oblique'].includes(options.view)) throw new RangeError('Unknown puzzle viewpoint');
    this.options = { ...options };
    this.puzzle = new ParcelPuzzle(input, options);
    this.element = document.createElement('div');
    this.element.className = 'sv-parcel-puzzle';
    const style = document.createElement('style'); style.textContent = puzzleStyles;
    this.stage = document.createElement('div'); this.stage.className = 'sv-parcel-puzzle-stage';
    this.status = document.createElement('div'); this.status.className = 'sv-parcel-puzzle-status';
    this.status.setAttribute('role', 'status');
    this.status.textContent = 'Hover to lift · click to inspect · drag the brain to orbit';
    this.detail = document.createElement('aside'); this.detail.className = 'sv-parcel-puzzle-detail';
    this.detail.setAttribute('aria-label', 'Parcel detail');
    const label = document.createElement('label'); label.textContent = 'Inspect a parcel';
    this.selector = document.createElement('select'); this.selector.setAttribute('aria-label', 'Inspect a parcel');
    this.selector.add(new Option('Choose a parcel…', ''));
    try {
      for (const [id, piece] of this.puzzle.geometry.pieces) this.selector.add(new Option(`${this.label(piece.parcel)} · ${id}`, String(id)));
    } catch (error) { this.puzzle.dispose(); throw error; }
    label.appendChild(this.selector);
    this.content = document.createElement('div');
    this.detail.append(label, this.content);
    this.element.append(style, this.stage, this.detail);
    container.appendChild(this.element);
    this.viewer = new NeuroSurfaceViewer(this.stage, this.stage.clientWidth || 640, this.stage.clientHeight || 600, {
      backgroundColor: 0xf0f3f4, useShaders: false, ambientLightColor: 0xffffff,
      directionalLightIntensity: 2.4, hoverCrosshair: false
    });
    if (this.viewer.initializationFailed) {
      this.viewer.dispose(); this.puzzle.dispose(); this.element.remove();
      throw new Error('ParcelPuzzleView requires a working WebGL renderer');
    }
    this.viewer.scene.add(this.puzzle.group);
    this.viewer.ambientLight.intensity = 1.35;
    this.viewer.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.viewer.camera.far = this.puzzle.radius * 30;
    const canvas = this.viewer.renderer.domElement;
    canvas.tabIndex = 0;
    canvas.setAttribute('aria-label', 'Cortical parcel puzzle. Drag to orbit; select a parcel using the adjacent menu.');
    canvas.dataset.puzzleCanvas = 'true';
    this.stage.appendChild(this.status);
    this.media = typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
    this.bind(canvas, 'pointerdown', event => this.pointerDown(event as PointerEvent, false), true);
    this.bind(canvas, 'pointermove', event => this.pointerMove(event as PointerEvent, false), true);
    this.bind(canvas, 'pointerleave', () => { if (!this.drag) this.puzzle.setHoveredParcel(null); });
    this.bind(window, 'pointerup', event => this.pointerUp(event as PointerEvent));
    this.bind(window, 'pointercancel', () => this.cancelDrag());
    this.bind(window, 'blur', () => { this.cancelDrag(); this.puzzle.setHoveredParcel(null); });
    this.bind(this.selector, 'change', () => this.selectParcel(this.selector.value === '' ? null : Number(this.selector.value)));
    this.bind(this.element, 'keydown', event => this.keyDown(event as KeyboardEvent));
    this.disposers.push(this.puzzle.on('change', () => this.viewer.requestRender()));
    this.disposers.push(this.puzzle.on('hover', event => {
      this.element.dataset.hoveredParcel = event.parcelId === null ? '' : String(event.parcelId);
      this.status.textContent = event.piece ? `${this.label(event.piece.parcel)} · click to inspect` : 'Hover to lift · click to inspect · drag the brain to orbit';
      this.emit('parcel:hover', event);
    }));
    this.disposers.push(this.puzzle.on('select', event => {
      this.cancelDrag();
      this.element.dataset.selectedParcel = event.parcelId === null ? '' : String(event.parcelId);
      this.selector.value = event.parcelId === null ? '' : String(event.parcelId);
      this.mountDetail(event);
      this.emit('selection:changed', event);
    }));
    this.disposers.push(this.viewer.on('render:before', () => this.beforeRender()));
    this.resizeObserver = new ResizeObserver(() => {
      if (this.disposed) return;
      if (this.stage.clientWidth && this.stage.clientHeight) {
        this.viewer.resize(this.stage.clientWidth, this.stage.clientHeight);
        this.fitCamera();
      }
      if (this.detailViewer) this.resizeDetail();
    });
    this.resizeObserver.observe(this.stage);
    this.setView(options.view ?? 'oblique');
    this.mountDetail({ parcelId: null, piece: null });
    this.element.dataset.ready = 'true';
    this.viewer.startRenderLoop();
  }

  selectParcel(id: number | null): void { this.assertLive(); this.cancelDrag(); this.puzzle.selectParcel(id); }
  setSeparation(value: number): void { this.assertLive(); this.puzzle.setSeparation(value); this.fitCamera(); }
  setRelief(value: number): void { this.assertLive(); this.puzzle.setRelief(value); }

  setView(view: 'lateral' | 'medial' | 'oblique'): void {
    this.assertLive();
    if (!['lateral', 'medial', 'oblique'].includes(view)) throw new RangeError('Unknown puzzle viewpoint');
    const direction = view === 'medial' ? new THREE.Vector3(1, 0, 0) :
      view === 'lateral' ? new THREE.Vector3(-1, 0, 0) : new THREE.Vector3(-1, -0.24, 0.16).normalize();
    this.viewer.camera.position.copy(direction).multiplyScalar(this.puzzle.radius * 3);
    this.viewer.camera.up.set(0, 0, 1);
    this.viewer.camera.lookAt(0, 0, 0);
    this.viewer.cameraControls.target.set(0, 0, 0);
    this.viewer.cameraControls.update();
    this.fitCamera();
    this.viewer.requestRender();
  }

  /** Project the moving piece's center into client coordinates for application anchors. */
  getParcelScreenPosition(id: number): { x: number; y: number } {
    this.assertLive();
    const p = this.puzzle.getParcelPosition(id).project(this.viewer.camera);
    const rect = this.viewer.renderer.domElement.getBoundingClientRect();
    return { x: rect.left + (p.x + 1) * rect.width / 2, y: rect.top + (1 - p.y) * rect.height / 2 };
  }

  dispose(): void {
    if (this.disposed) return;
    this.cancelDrag();
    this.disposed = true;
    this.resizeObserver.disconnect();
    this.disposers.splice(0).forEach(dispose => dispose());
    this.clearDetail();
    this.puzzle.dispose(); this.viewer.dispose();
    this.element.remove();
    this.removeAllListeners();
  }

  private beforeRender(): void {
    const now = performance.now();
    const dt = this.lastFrame ? Math.min((now - this.lastFrame) / 1000, 0.05) : 1 / 60;
    this.lastFrame = now;
    this.viewer.camera.getWorldDirection(this.direction).negate();
    const moving = this.puzzle.update(dt, this.direction, this.options.reducedMotion ?? this.media?.matches ?? false);
    if (this.detailViewer && this.detailMesh && this.puzzle.selectedParcelId !== null) {
      this.detailMesh.quaternion.copy(this.puzzle.getParcelRotation(this.puzzle.selectedParcelId));
      this.detailViewer.requestRender();
    }
    if (moving) this.viewer.requestRender();
  }

  private pick(event: PointerEvent): number | null {
    const rect = this.viewer.renderer.domElement.getBoundingClientRect();
    this.viewer.camera.updateMatrixWorld();
    this.raycaster.setFromCamera(new THREE.Vector2((event.clientX - rect.left) / rect.width * 2 - 1,
      -(event.clientY - rect.top) / rect.height * 2 + 1), this.viewer.camera);
    return this.puzzle.pick(this.raycaster);
  }

  private pointerDown(event: PointerEvent, detail: boolean): void {
    if (this.drag || event.button !== 0 || !event.isPrimary) return;
    const id = detail ? this.puzzle.selectedParcelId : this.pick(event);
    const rotate = id !== null && id === this.puzzle.selectedParcelId;
    this.drag = { pointer: event.pointerId, x: event.clientX, y: event.clientY, distance: 0,
      parcelId: id, rotate, controlsEnabled: this.viewer.isInteractionEnabled(), target: event.currentTarget as HTMLElement };
    if (rotate) {
      event.preventDefault(); event.stopImmediatePropagation();
      this.viewer.setInteractionEnabled(false);
      this.drag.target.setPointerCapture(event.pointerId);
    }
  }

  private pointerMove(event: PointerEvent, detail: boolean): void {
    if (!this.drag) { if (!detail && event.pointerType !== 'touch') this.puzzle.setHoveredParcel(this.pick(event)); return; }
    if (event.pointerId !== this.drag.pointer) return;
    const dx = event.clientX - this.drag.x, dy = event.clientY - this.drag.y;
    this.drag.distance += Math.hypot(dx, dy); this.drag.x = event.clientX; this.drag.y = event.clientY;
    if (!this.drag.rotate) return;
    event.preventDefault(); event.stopImmediatePropagation();
    const camera = detail && this.detailViewer ? this.detailViewer.camera : this.viewer.camera;
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
    this.puzzle.rotateSelected(up, dx * 0.012);
    this.puzzle.rotateSelected(right, dy * 0.012);
  }

  private pointerUp(event: PointerEvent): void {
    if (!this.drag || event.pointerId !== this.drag.pointer) return;
    const drag = this.drag;
    this.cancelDrag();
    if (!drag.rotate && drag.distance < 5) this.selectParcel(drag.parcelId);
  }

  private cancelDrag(): void {
    if (!this.drag) return;
    const drag = this.drag; this.drag = null;
    if (drag.target.hasPointerCapture(drag.pointer)) drag.target.releasePointerCapture(drag.pointer);
    if (drag.rotate) this.viewer.setInteractionEnabled(drag.controlsEnabled);
  }

  private keyDown(event: KeyboardEvent): void {
    if (event.key === 'Escape') { event.preventDefault(); this.selectParcel(null); return; }
    if (event.target !== this.detailViewer?.renderer.domElement || this.puzzle.selectedParcelId === null) return;
    const amount = event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -0.12 : 0.12;
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
    event.preventDefault();
    const axis = new THREE.Vector3(...(event.key === 'ArrowLeft' || event.key === 'ArrowRight' ? [0, 1, 0] as const : [1, 0, 0] as const));
    axis.applyQuaternion(this.detailViewer.camera.quaternion);
    this.puzzle.rotateSelected(axis, amount);
  }

  private mountDetail(selection: ParcelPuzzleSelection): void {
    this.clearDetail(); this.content.replaceChildren();
    if (!selection.piece || selection.parcelId === null) {
      const heading = document.createElement('h2'); heading.textContent = 'A closer look';
      const text = document.createElement('p'); text.textContent = 'Choose a piece to lift it out of the cortex and inspect its shape.';
      const help = document.createElement('p'); help.className = 'sv-parcel-puzzle-help';
      help.textContent = 'The empty socket keeps its original location visible. Drag a selected piece to turn it independently.';
      this.content.append(heading, text, help); return;
    }
    const piece = selection.piece;
    const heading = document.createElement('h2'); heading.textContent = this.label(piece.parcel);
    const preview = document.createElement('div'); preview.className = 'sv-parcel-puzzle-preview';
    const help = document.createElement('p'); help.className = 'sv-parcel-puzzle-help';
    help.textContent = 'Drag to rotate this piece · arrow keys also rotate';
    const actions = document.createElement('div'); actions.className = 'sv-parcel-puzzle-actions';
    const reset = document.createElement('button'); reset.type = 'button'; reset.textContent = 'Reset rotation';
    const close = document.createElement('button'); close.type = 'button'; close.textContent = 'Return piece';
    actions.append(reset, close);
    const custom = document.createElement('div'); custom.className = 'sv-parcel-puzzle-custom';
    this.content.append(heading, preview, help, actions, custom);
    this.detailDisposers.push(this.listen(reset, 'click', () => this.puzzle.resetSelectedRotation()));
    this.detailDisposers.push(this.listen(close, 'click', () => this.selectParcel(null)));
    this.detailViewer = new NeuroSurfaceViewer(preview, preview.clientWidth || 240, preview.clientHeight || 220, {
      backgroundColor: 0xedf1f2, useShaders: false, ambientLightColor: 0xffffff,
      directionalLightIntensity: 2.4, hoverCrosshair: false
    });
    if (this.detailViewer.initializationFailed) {
      this.detailViewer.dispose(); this.detailViewer = null;
    } else {
      this.detailViewer.setInteractionEnabled(false);
      this.detailViewer.ambientLight.intensity = 1.35;
      this.detailViewer.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      const color = this.puzzle.getParcelColor(piece.parcel.id);
      const top = new THREE.MeshStandardMaterial({ color, roughness: 0.7, metalness: 0.03 });
      const side = new THREE.MeshStandardMaterial({ color: top.color.clone().multiplyScalar(0.66), roughness: 0.9 });
      this.detailMesh = new THREE.Mesh(piece.geometry, [top, side]);
      this.detailViewer.scene.add(this.detailMesh);
      const radius = piece.geometry.boundingSphere!.radius + piece.geometry.boundingSphere!.center.length();
      const direction = this.viewer.camera.position.clone().normalize();
      this.detailViewer.camera.position.copy(direction).multiplyScalar(radius * 3.8);
      this.detailViewer.camera.up.copy(this.viewer.camera.up);
      this.detailViewer.camera.far = Math.max(1000, radius * 20);
      this.detailViewer.camera.lookAt(0, 0, 0);
      this.detailViewer.camera.updateProjectionMatrix();
      const canvas = this.detailViewer.renderer.domElement;
      canvas.tabIndex = 0; canvas.dataset.puzzleDetailCanvas = 'true';
      canvas.setAttribute('aria-label', `Rotate ${this.label(piece.parcel)}. Drag or use arrow keys.`);
      this.detailDisposers.push(this.listen(canvas, 'pointerdown', event => this.pointerDown(event as PointerEvent, true), true));
      this.detailDisposers.push(this.listen(canvas, 'pointermove', event => this.pointerMove(event as PointerEvent, true), true));
      this.detailViewer.startRenderLoop();
    }
    this.detailAbort = new AbortController();
    try {
      if (this.options.renderDetail) {
        this.detailCleanup = this.options.renderDetail(custom, { parcel: piece.parcel, piece, signal: this.detailAbort.signal }) ?? null;
      } else {
        const rows = [['Parcel ID', String(piece.parcel.id)], ['Hemisphere', piece.parcel.hemi ?? 'Unspecified'],
          ['Source vertices', piece.sourceVertexCount.toLocaleString()], ['Surface area', `${piece.surfaceArea.toFixed(1)} units²`]];
        const dl = document.createElement('dl');
        rows.forEach(([name, value]) => {
          const dt = document.createElement('dt'); dt.textContent = name!;
          const dd = document.createElement('dd'); dd.textContent = value!;
          dl.append(dt, dd);
        });
        custom.appendChild(dl);
      }
    } catch (error) {
      custom.textContent = 'Additional parcel information could not be displayed.';
      this.emit('detail:error', { parcelId: selection.parcelId, error });
    }
  }

  private resizeDetail(): void {
    if (!this.detailViewer) return;
    const container = this.detailViewer.container;
    if (container.clientWidth && container.clientHeight) this.detailViewer.resize(container.clientWidth, container.clientHeight);
  }

  /** Fit the expanded source bounds in the current orientation, including narrow viewports. */
  private fitCamera(): void {
    const camera = this.viewer.camera, target = this.viewer.cameraControls.target;
    const forward = camera.position.clone().sub(target).normalize();
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
    const bounds = this.puzzle.geometry.bounds, center = bounds.getCenter(new THREE.Vector3());
    const halfFov = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    let distance = this.puzzle.radius;
    for (const x of [bounds.min.x, bounds.max.x]) for (const y of [bounds.min.y, bounds.max.y]) for (const z of [bounds.min.z, bounds.max.z]) {
      const p = new THREE.Vector3(x, y, z).sub(center).multiplyScalar(1 + this.puzzle.getSeparation()).sub(target);
      const depth = p.dot(forward);
      distance = Math.max(distance, depth + 1.12 * Math.abs(p.dot(right)) / (halfFov * camera.aspect),
        depth + 1.12 * Math.abs(p.dot(up)) / halfFov);
    }
    camera.position.copy(target).addScaledVector(forward, distance + this.puzzle.geometry.thickness);
    camera.lookAt(target);
    this.viewer.cameraControls.update();
    this.viewer.requestRender();
  }

  private clearDetail(): void {
    this.detailAbort?.abort(); this.detailAbort = null;
    const cleanup = this.detailCleanup; this.detailCleanup = null;
    try { cleanup?.(); } catch (error) { console.error('Parcel detail cleanup failed', error); }
    this.detailDisposers.splice(0).forEach(dispose => dispose());
    this.detailMesh?.removeFromParent();
    this.detailMesh?.material.forEach(material => material.dispose());
    this.detailMesh = null;
    this.detailViewer?.dispose(); this.detailViewer = null;
  }

  private listen(target: EventTarget, type: string, listener: EventListener, capture = false): () => void {
    target.addEventListener(type, listener, capture);
    return () => target.removeEventListener(type, listener, capture);
  }

  private bind(target: EventTarget, type: string, listener: EventListener, capture = false): void {
    this.disposers.push(this.listen(target, type, listener, capture));
  }

  private assertLive(): void { if (this.disposed) throw new Error('ParcelPuzzleView has been disposed'); }

  private label(parcel: Readonly<ParcelRecord>): string { return this.options.labelText?.(parcel) ?? parcel.label; }
}
