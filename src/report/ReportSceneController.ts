import * as THREE from 'three';
import {
  ANATOMICAL_VIEWS,
  freezeBilateralSurfaceGroup,
  getAnatomicalViewAxes
} from '../AnatomicalView';
import type {
  AnatomicalView,
  AnatomicalViewChangedEvent,
  BilateralSurfaceGroup
} from '../AnatomicalView';
import type {
  AnatomicalViewTargetRef,
  ControlCommandResult
} from '../controls/ControlTarget';
import type { MultiLayerNeuroSurface } from '../MultiLayerNeuroSurface';
import { DataLayer } from '../layers';
import type { NeuroSurfaceViewer } from '../NeuroSurfaceViewer';
import type { SurfViewSceneManifest } from '../scene';

export interface ReportAnatomicalMesh {
  readonly id: string;
  readonly hemisphere: 'left' | 'right';
  readonly mesh: THREE.Object3D;
}

/**
 * How a bilateral report pair is posed.
 *
 * - `split` rotates each hemisphere independently into the requested view and
 *   places them side by side (the print-figure idiom).
 * - `anatomical` keeps both hemispheres in one coherent RAS scene, separated
 *   only enough to clear the midline, and rotates the brain as a whole.
 */
export type ReportLayout = 'split' | 'anatomical';

/** Whole-brain camera presets for the anatomical layout. */
export type ReportBrainView =
  | 'left'
  | 'right'
  | 'left-medial'
  | 'right-medial'
  | 'dorsal'
  | 'ventral'
  | 'anterior'
  | 'posterior'
  | 'oblique';

export const REPORT_BRAIN_VIEWS: readonly ReportBrainView[] = Object.freeze([
  'left',
  'right',
  'left-medial',
  'right-medial',
  'dorsal',
  'ventral',
  'anterior',
  'posterior',
  'oblique'
]);

export interface ReportSceneControllerOptions {
  readonly bilateralGroup?: BilateralSurfaceGroup;
  readonly initialView?: AnatomicalView;
  readonly hemisphereGap?: number;
  /** Pair pose. Defaults to `split` for backwards compatibility. */
  readonly layout?: ReportLayout;
  /** Initial whole-brain view for the anatomical layout. Defaults to `oblique`. */
  readonly initialBrainView?: ReportBrainView;
  /** Keep the key light attached to the camera so every pose is lit alike. */
  readonly headlight?: boolean;
  /** Camera fit margin as a fraction of the framed distance (0.1 anatomical, 0.12 split). */
  readonly fitMargin?: number;
  /** Vertical field of view in degrees. Narrow fields reduce perspective distortion. */
  readonly fov?: number;
  /**
   * Camera angle of the `oblique` brain view, or `auto` to choose, per
   * displayed map, the oblique angle that faces the most suprathreshold cortex.
   */
  readonly oblique?: ReportObliqueAngle | 'auto';
  /**
   * Canvas insets in CSS pixels kept clear of the fitted brain, for embedders
   * that float controls over the canvas. The brain is framed and centred in
   * the remaining rectangle; orbiting still pivots about the brain centre.
   */
  readonly fitInsets?: ReportFitInsets;
}

export interface ReportFitInsets {
  readonly top?: number;
  readonly right?: number;
  readonly bottom?: number;
  readonly left?: number;
}

export interface ReportSceneControllerState {
  readonly displayedLayerId: string | null;
  readonly currentView: {
    readonly view: AnatomicalView;
    readonly target: AnatomicalViewTargetRef;
  } | null;
}

export type ReportSceneMutationPhase = 'begin' | 'end';
export type ReportSceneMutationListener = (phase: ReportSceneMutationPhase) => void;
export type ReportSceneDisposingListener = () => void;

const SUCCESS: ControlCommandResult = Object.freeze({ ok: true });

function failure(
  code: 'surface-not-found' | 'layer-not-found' | 'group-not-found' |
    'unsupported' | 'invalid-value' | 'conflict' | 'disposed',
  message: string
): ControlCommandResult {
  return Object.freeze({ ok: false, code, message });
}

function viewQuaternion(
  hemisphere: 'left' | 'right',
  view: AnatomicalView
): THREE.Quaternion {
  const axes = getAnatomicalViewAxes(hemisphere, view);
  const sourceForward = new THREE.Vector3(...axes.direction).normalize();
  const sourceUp = new THREE.Vector3(...axes.up).normalize();
  const sourceRight = sourceUp.clone().cross(sourceForward).normalize();
  sourceUp.copy(sourceForward).cross(sourceRight).normalize();

  const sourceBasis = new THREE.Matrix4().makeBasis(
    sourceRight,
    sourceUp,
    sourceForward
  );
  return new THREE.Quaternion().setFromRotationMatrix(sourceBasis.invert());
}

interface BrainAxes {
  readonly direction: readonly [number, number, number];
  readonly up: readonly [number, number, number];
  /** Hemisphere hidden in this view, if any (medial views). */
  readonly hide?: 'left' | 'right';
}

function normalizedTuple(x: number, y: number, z: number): [number, number, number] {
  const length = Math.hypot(x, y, z);
  return [x / length, y / length, z / length];
}

/**
 * Oblique camera angle in degrees. Azimuth turns in the axial plane from
 * anterior (0) through right (90) and posterior (180) to left (-90);
 * elevation is positive above the axial plane.
 */
export interface ReportObliqueAngle {
  readonly azimuth: number;
  readonly elevation: number;
}

export const DEFAULT_REPORT_OBLIQUE: ReportObliqueAngle = Object.freeze({
  azimuth: -124,
  elevation: 41
});

function obliqueDirection(angle: ReportObliqueAngle): [number, number, number] {
  const az = THREE.MathUtils.degToRad(angle.azimuth);
  const el = THREE.MathUtils.degToRad(angle.elevation);
  return normalizedTuple(Math.sin(az) * Math.cos(el), Math.cos(az) * Math.cos(el), Math.sin(el));
}

/** RAS direction from the brain toward the camera, and the screen-up axis. */
export function reportBrainViewAxes(
  view: ReportBrainView,
  oblique: ReportObliqueAngle = DEFAULT_REPORT_OBLIQUE
): BrainAxes {
  switch (view) {
    case 'left': return { direction: [-1, 0, 0], up: [0, 0, 1] };
    case 'right': return { direction: [1, 0, 0], up: [0, 0, 1] };
    case 'left-medial': return { direction: [1, 0, 0], up: [0, 0, 1], hide: 'right' };
    case 'right-medial': return { direction: [-1, 0, 0], up: [0, 0, 1], hide: 'left' };
    case 'dorsal': return { direction: [0, 0, 1], up: [0, 1, 0] };
    case 'ventral': return { direction: [0, 0, -1], up: [0, 1, 0] };
    case 'anterior': return { direction: [0, 1, 0], up: [0, 0, 1] };
    case 'posterior': return { direction: [0, -1, 0], up: [0, 0, 1] };
    case 'oblique': return { direction: obliqueDirection(oblique), up: [0, 0, 1] };
  }
}

function axesQuaternion(
  direction: readonly [number, number, number],
  up: readonly [number, number, number]
): THREE.Quaternion {
  const forward = new THREE.Vector3(...direction).normalize();
  const upVector = new THREE.Vector3(...up).normalize();
  const right = upVector.clone().cross(forward).normalize();
  upVector.copy(forward).cross(right).normalize();
  const basis = new THREE.Matrix4().makeBasis(right, upVector, forward);
  return new THREE.Quaternion().setFromRotationMatrix(basis.invert());
}

/**
 * Pose a bilateral pair as one brain: each hemisphere keeps its RAS placement,
 * is pushed laterally just enough to clear the midline by `hemisphereGap`, and
 * the pair rotates rigidly about its common centre.
 */
export function layoutReportAnatomicalBrain(
  targets: readonly ReportAnatomicalMesh[],
  view: ReportBrainView,
  hemisphereGap: number,
  oblique: ReportObliqueAngle = DEFAULT_REPORT_OBLIQUE
): void {
  if (!Number.isFinite(hemisphereGap) || hemisphereGap < 0) {
    throw new RangeError('hemisphereGap must be a finite, non-negative number');
  }
  const axes = reportBrainViewAxes(view, oblique);
  const offsets = new Map<string, THREE.Vector3>();
  const combined = new THREE.Box3();
  for (const target of targets) {
    target.mesh.position.set(0, 0, 0);
    target.mesh.quaternion.identity();
    target.mesh.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(target.mesh);
    const offset = new THREE.Vector3();
    if (targets.length > 1) {
      offset.x = target.hemisphere === 'left'
        ? -hemisphereGap / 2 - box.max.x
        : hemisphereGap / 2 - box.min.x;
    }
    offsets.set(target.id, offset);
    combined.union(box.clone().translate(offset));
  }
  const center = combined.getCenter(new THREE.Vector3());
  const rotation = axesQuaternion(axes.direction, axes.up);
  for (const target of targets) {
    const offset = offsets.get(target.id)!;
    target.mesh.quaternion.copy(rotation);
    target.mesh.position.copy(offset.clone().sub(center).applyQuaternion(rotation));
    target.mesh.visible = axes.hide !== target.hemisphere;
    target.mesh.updateMatrixWorld(true);
  }
}

function normalizeFitInsets(insets: ReportFitInsets = {}): Required<ReportFitInsets> {
  const normalized = Object.freeze({
    top: insets.top ?? 0,
    right: insets.right ?? 0,
    bottom: insets.bottom ?? 0,
    left: insets.left ?? 0
  });
  if (Object.values(normalized).some(value => !Number.isFinite(value) || value < 0)) {
    throw new RangeError('fitInsets must be finite, non-negative pixel values');
  }
  return normalized;
}

interface ObliqueScoringTarget {
  readonly hemisphere: 'left' | 'right';
  readonly surface: MultiLayerNeuroSurface;
  readonly layer: unknown;
}

/**
 * Choose the oblique camera angle that shows the most suprathreshold cortex.
 *
 * Each shown vertex weighs 1 + (distance beyond the threshold); a pose scores
 * the weighted sum of max(0, n·d) over vertices, with medial-wall-facing
 * vertices discounted because the other hemisphere hides them in a
 * whole-brain pose. Near-canonical azimuths are skipped (those poses have
 * their own presets); elevation stays within 0..40 degrees with a
 * preference for slightly-above views (views from below disorient readers),
 * and facing is squared so clusters seen at grazing angles count little.
 * Falls back to `fallback` when the map has no thresholded vertices.
 */
export function chooseInformativeOblique(
  targets: readonly ObliqueScoringTarget[],
  fallback: ReportObliqueAngle
): ReportObliqueAngle {
  const samples: Array<{ x: number; y: number; z: number; w: number }> = [];
  for (const { hemisphere, surface, layer } of targets) {
    if (!(layer instanceof DataLayer)) continue;
    const mesh = surface.mesh;
    const normals = (mesh?.geometry as THREE.BufferGeometry | undefined)?.getAttribute('normal');
    if (!normals) continue;
    const count = normals.count;
    const colors = new Float32Array(count * 4);
    const edges = new Float32Array(count);
    if (!layer.writeThresholdEdgeAttributes(count, colors, edges)) continue;
    const medialSign = hemisphere === 'left' ? 1 : -1;
    for (let v = 0; v < count; v++) {
      const edge = edges[v]!;
      if (!(edge > 0)) continue;
      const nx = normals.getX(v), ny = normals.getY(v), nz = normals.getZ(v);
      const medial = nx * medialSign > 0.35 ? 0.15 : 1;
      samples.push({ x: nx, y: ny, z: nz, w: (1 + edge) * medial });
    }
  }
  if (samples.length === 0) return fallback;
  let best = fallback;
  let bestScore = -Infinity;
  for (let azimuth = -180; azimuth < 180; azimuth += 10) {
    const fromCanonical = Math.min(...[-180, -90, 0, 90, 180].map(c => Math.abs(azimuth - c)));
    if (fromCanonical < 25) continue;
    for (const elevation of [0, 10, 20, 30, 40]) {
      const [dx, dy, dz] = obliqueDirection({ azimuth, elevation });
      let score = 0;
      for (const sample of samples) {
        // Squared facing: clusters seen head-on count, grazing ones barely.
        const facing = sample.x * dx + sample.y * dy + sample.z * dz;
        if (facing > 0) score += sample.w * facing * facing;
      }
      // Readers orient best slightly above the horizon; steep views from
      // below or above cost legibility more than they gain coverage.
      score *= 1 - 0.35 * Math.abs(elevation - 15) / 25;
      if (score > bestScore) {
        bestScore = score;
        best = { azimuth, elevation };
      }
    }
  }
  return Object.freeze(best);
}

/** Deterministic report-mesh mechanics over an explicitly coordinated target list. */
export function layoutReportAnatomicalMeshes(
  targets: readonly ReportAnatomicalMesh[],
  view: AnatomicalView,
  hemisphereGap: number,
  paired: boolean
): void {
  if (!Number.isFinite(hemisphereGap) || hemisphereGap < 0) {
    throw new RangeError('hemisphereGap must be a finite, non-negative number');
  }
  const dimensions = new Map<string, THREE.Vector3>();
  for (const target of targets) {
    target.mesh.position.set(0, 0, 0);
    target.mesh.visible = true;
    target.mesh.quaternion.copy(viewQuaternion(target.hemisphere, view));
    target.mesh.updateMatrixWorld(true);
    dimensions.set(
      target.id,
      new THREE.Box3().setFromObject(target.mesh).getSize(new THREE.Vector3())
    );
  }

  for (const target of targets) {
    const center = new THREE.Box3().setFromObject(target.mesh).getCenter(new THREE.Vector3());
    target.mesh.position.sub(center);
    if (paired) {
      const ownWidth = dimensions.get(target.id)?.x ?? 0;
      target.mesh.position.x += target.hemisphere === 'left'
        ? -(ownWidth / 2 + hemisphereGap / 2)
        : ownWidth / 2 + hemisphereGap / 2;
    }
    target.mesh.updateMatrixWorld(true);
  }
}

/**
 * Owns the coordinated semantics that make a portable report scene different
 * from an ordinary viewer: one displayed map and one explicit report view
 * target. It never writes the pane-era selected layer or surface fields.
 */
export class ReportSceneController {
  readonly options: ReportSceneControllerOptions;
  private readonly initialView: AnatomicalView;
  private readonly hemisphereGap: number;
  private readonly layout: ReportLayout;
  private readonly initialBrainView: ReportBrainView;
  private readonly fitMargin: number;
  private readonly oblique: ReportObliqueAngle;
  private readonly autoOblique: boolean;
  private readonly autoObliqueCache = new Map<string, ReportObliqueAngle>();
  private fitInsets: Required<ReportFitInsets>;
  private currentBrainView: ReportBrainView | null = null;
  private readonly viewerUnsubscribers: Array<() => void> = [];
  private readonly mutationListeners = new Set<ReportSceneMutationListener>();
  private readonly disposingListeners = new Set<ReportSceneDisposingListener>();
  private displayedLayerId: string | null;
  private currentView: ReportSceneControllerState['currentView'] = null;
  private changingLayers = false;
  private changingView = false;
  private mutationDepth = 0;
  private disposed = false;

  constructor(
    readonly viewer: NeuroSurfaceViewer,
    readonly manifest: SurfViewSceneManifest,
    options: ReportSceneControllerOptions = {}
  ) {
    this.options = Object.freeze({
      ...options,
      ...(options.bilateralGroup
        ? { bilateralGroup: freezeBilateralSurfaceGroup(options.bilateralGroup) }
        : {})
    });
    this.initialView = this.options.initialView ?? 'lateral';
    this.hemisphereGap = this.options.hemisphereGap ?? 8;
    this.layout = this.options.layout ?? 'split';
    this.initialBrainView = this.options.initialBrainView ?? 'oblique';
    this.autoOblique = this.options.oblique === 'auto';
    this.oblique = Object.freeze({
      ...(this.options.oblique === undefined || this.options.oblique === 'auto'
        ? DEFAULT_REPORT_OBLIQUE
        : this.options.oblique)
    });
    if (!Number.isFinite(this.oblique.azimuth) || !Number.isFinite(this.oblique.elevation) ||
        Math.abs(this.oblique.elevation) > 90) {
      throw new RangeError('oblique needs a finite azimuth and an elevation within ±90 degrees');
    }
    this.fitInsets = normalizeFitInsets(this.options.fitInsets);
    this.fitMargin = this.options.fitMargin ?? (this.layout === 'anatomical' ? 0.1 : 0.12);
    if (this.layout !== 'split' && this.layout !== 'anatomical') {
      throw new RangeError(`Unsupported report layout "${String(this.layout)}".`);
    }
    if (!REPORT_BRAIN_VIEWS.includes(this.initialBrainView)) {
      throw new RangeError(`Unsupported initial brain view "${String(this.initialBrainView)}".`);
    }
    if (!Number.isFinite(this.fitMargin) || this.fitMargin < 0) {
      throw new RangeError('fitMargin must be a finite, non-negative number');
    }
    if (this.options.fov !== undefined) {
      if (!Number.isFinite(this.options.fov) || this.options.fov <= 0 || this.options.fov >= 180) {
        throw new RangeError('fov must be between 0 and 180 degrees');
      }
      viewer.camera.fov = this.options.fov;
      viewer.camera.updateProjectionMatrix();
    }
    if (this.options.headlight ?? this.layout === 'anatomical') {
      // Key light above-right of the camera, fill below-left: fixed in camera
      // space so every pose and free rotation is lit alike.
      const keyOffset = new THREE.Vector3(0.4, 0.6, 0.8).normalize();
      const fillOffset = new THREE.Vector3(-0.5, -0.3, 0.6).normalize();
      const worldOffset = new THREE.Vector3();
      const place = (light: THREE.DirectionalLight | undefined, offset: THREE.Vector3) => {
        const controls = viewer.cameraControls;
        if (!light || !controls) return;
        const distance = viewer.camera.position.distanceTo(controls.target) || 1;
        worldOffset.copy(offset).multiplyScalar(distance).applyQuaternion(viewer.camera.quaternion);
        light.position.copy(viewer.camera.position).add(worldOffset);
        light.target.position.copy(controls.target);
        light.target.updateMatrixWorld();
      };
      this.viewerUnsubscribers.push(viewer.on('render:before', () => {
        place(viewer.directionalLight, keyOffset);
        place(viewer.fillLight, fillOffset);
      }));
    }
    if (!ANATOMICAL_VIEWS.includes(this.initialView)) {
      throw new RangeError(`Unsupported initial report view "${String(this.initialView)}".`);
    }
    if (!Number.isFinite(this.hemisphereGap) || this.hemisphereGap < 0) {
      throw new RangeError('hemisphereGap must be a finite, non-negative number');
    }
    this.displayedLayerId = this.deriveDisplayedLayerId();
    this.viewerUnsubscribers.push(
      viewer.on('state:changed', event => {
        if (!this.changingLayers &&
            (event.domains.includes('layers') || event.domains.includes('surfaces'))) {
          this.displayedLayerId = this.deriveDisplayedLayerId();
        }
        if (!this.changingView && event.domains.includes('camera')) {
          this.currentView = null;
          this.currentBrainView = null;
        }
      }),
      viewer.on('anatomical-view:changed', event => this.observeView(event)),
      viewer.on('anatomical-view:reset', () => {
        if (!this.changingView) this.currentView = null;
      }),
      viewer.on('viewer:disposing', () => this.dispose())
    );
  }

  getState(): ReportSceneControllerState {
    return Object.freeze({
      displayedLayerId: this.displayedLayerId,
      currentView: this.currentView
    });
  }

  /** @internal Target adapters use this boundary to publish compound commands atomically. */
  subscribeMutationBoundary(listener: ReportSceneMutationListener): () => void {
    if (typeof listener !== 'function') {
      throw new TypeError('A report mutation subscription requires a listener function.');
    }
    if (this.disposed) return () => {};
    this.mutationListeners.add(listener);
    return () => this.mutationListeners.delete(listener);
  }

  /** @internal Eager lifecycle signal for target adapters owned by this controller. */
  subscribeDisposing(listener: ReportSceneDisposingListener): () => void {
    if (typeof listener !== 'function') {
      throw new TypeError('A report disposal subscription requires a listener function.');
    }
    if (this.disposed) {
      listener();
      return () => {};
    }
    this.disposingListeners.add(listener);
    return () => this.disposingListeners.delete(listener);
  }

  getAvailableLayerIds(): readonly string[] {
    return Object.freeze(Object.values(this.manifest.layers)
      .filter(layer => this.getReportSurfaces().some(({ id }) =>
        this.viewer.getOrderedLayers(id).some(candidate => candidate.id === layer.id)
      ))
      .map(layer => layer.id));
  }

  getViewTarget(): AnatomicalViewTargetRef | null {
    if (this.options.bilateralGroup) {
      const configured = this.options.bilateralGroup;
      const registered = this.viewer.getBilateralSurfaceGroup(configured.id);
      return registered &&
        registered.leftSurfaceId === configured.leftSurfaceId &&
        registered.rightSurfaceId === configured.rightSurfaceId &&
        this.viewer.getSurface(configured.leftSurfaceId) &&
        this.viewer.getSurface(configured.rightSurfaceId)
        ? Object.freeze({ kind: 'group', groupId: configured.id })
        : null;
    }
    const surfaceIds = Object.keys(this.manifest.geometries);
    const onlySurfaceId = surfaceIds.length === 1 ? surfaceIds[0] : undefined;
    return onlySurfaceId !== undefined && this.viewer.getSurface(onlySurfaceId)
      ? Object.freeze({ kind: 'surface', surfaceId: onlySurfaceId })
      : null;
  }

  setDisplayedLayer(layerId: string): ControlCommandResult {
    const unavailable = this.commandUnavailable();
    if (unavailable) return unavailable;
    if (typeof layerId !== 'string' || layerId.length === 0) {
      return failure('invalid-value', 'A displayed report layer requires a stable layer ID.');
    }
    if (!this.manifest.layers[layerId]) {
      return failure('layer-not-found', `Report layer "${layerId}" was not found.`);
    }
    const reportSurfaces = this.getReportSurfaces();
    if (reportSurfaces.length === 0) {
      return failure('surface-not-found', 'No report surfaces are loaded.');
    }
    const layerInstances = reportSurfaces.flatMap(({ id }) =>
      this.viewer.getOrderedLayers(id).filter(layer =>
        Object.prototype.hasOwnProperty.call(this.manifest.layers, layer.id)
      )
    );
    if (!layerInstances.some(layer => layer.id === layerId)) {
      return failure('layer-not-found', `Report layer "${layerId}" has no loaded surface data.`);
    }

    return this.withMutationBoundary(() => {
      this.displayedLayerId = layerId;
      this.changingLayers = true;
      try {
        for (const layer of layerInstances) layer.setVisible(layer.id === layerId);
      } finally {
        this.changingLayers = false;
      }
      return SUCCESS;
    });
  }

  setAnatomicalView(
    view: AnatomicalView,
    target: AnatomicalViewTargetRef,
    options: { readonly fit?: boolean; readonly hemisphereGap?: number } = {}
  ): ControlCommandResult {
    const unavailable = this.commandUnavailable();
    if (unavailable) return unavailable;
    if (!ANATOMICAL_VIEWS.includes(view)) {
      return failure('invalid-value', `Unsupported anatomical view "${String(view)}".`);
    }
    if (!target || (target.kind !== 'surface' && target.kind !== 'group') ||
        (target.kind === 'surface' && typeof target.surfaceId !== 'string') ||
        (target.kind === 'group' && typeof target.groupId !== 'string')) {
      return failure('invalid-value', 'A report view requires a valid surface or group target.');
    }
    const reportTarget = this.getViewTarget();
    if (!reportTarget) {
      return failure(
        'unsupported',
        'Multiple report surfaces require an explicit bilateral group.'
      );
    }
    if (!this.targetsEqual(target, reportTarget)) {
      return target.kind === 'group'
        ? failure('group-not-found', `Report group "${target.groupId}" is not controlled here.`)
        : failure('surface-not-found', `Report surface "${target.surfaceId}" is not controlled here.`);
    }
    const gap = options.hemisphereGap ?? this.hemisphereGap;
    if (!Number.isFinite(gap) || gap < 0) {
      return failure('invalid-value', 'hemisphereGap must be a finite, non-negative number.');
    }
    const targets = this.resolveViewSurfaces();
    if ('ok' in targets) return targets;
    const fit = options.fit ?? true;
    if (this.layout === 'anatomical' && reportTarget.kind === 'group') {
      const brainView: ReportBrainView = view === 'lateral'
        ? 'left'
        : view === 'medial' ? 'left-medial' : view;
      return this.poseBrain(brainView, targets, gap, fit, view);
    }

    return this.withMutationBoundary(() => {
      this.changingView = true;
      try {
        this.currentBrainView = null;
        layoutReportAnatomicalMeshes(
          targets.map(({ id, hemisphere, surface }) => ({
            id,
            hemisphere,
            mesh: surface.mesh!
          })),
          view,
          gap,
          reportTarget.kind === 'group'
        );
        if (fit) this.fitCamera(targets);
        this.currentView = Object.freeze({ view, target: reportTarget });
        this.viewer.emit('anatomical-view:changed', {
          view,
          layout: reportTarget.kind === 'group' ? 'paired' : 'single',
          surfaceIds: Object.freeze(targets.map(surface => surface.id)),
          fit
        });
        this.viewer.requestRender();
      } finally {
        this.changingView = false;
      }
      return SUCCESS;
    });
  }

  /** Replace the overlay insets and refit the current framing. */
  setFitInsets(insets: ReportFitInsets): void {
    this.fitInsets = normalizeFitInsets(insets);
    this.resizeFit();
  }

  /** Current whole-brain view, or null after free rotation or a split-layout view. */
  getBrainView(): ReportBrainView | null {
    return this.currentBrainView;
  }

  getLayout(): ReportLayout {
    return this.layout;
  }

  /** Pose the report pair as one brain and frame it (anatomical layout only). */
  setBrainView(
    view: ReportBrainView,
    options: { readonly fit?: boolean; readonly hemisphereGap?: number } = {}
  ): ControlCommandResult {
    const unavailable = this.commandUnavailable();
    if (unavailable) return unavailable;
    if (!REPORT_BRAIN_VIEWS.includes(view)) {
      return failure('invalid-value', `Unsupported brain view "${String(view)}".`);
    }
    if (this.layout !== 'anatomical') {
      return failure('unsupported', 'Whole-brain views require the anatomical report layout.');
    }
    const gap = options.hemisphereGap ?? this.hemisphereGap;
    if (!Number.isFinite(gap) || gap < 0) {
      return failure('invalid-value', 'hemisphereGap must be a finite, non-negative number.');
    }
    const targets = this.resolveViewSurfaces();
    if ('ok' in targets) return targets;
    const anatomical: AnatomicalView | null =
      view === 'left' ? 'lateral'
        : view === 'left-medial' ? 'medial'
          : view === 'right' || view === 'right-medial' || view === 'oblique' ? null
            : view;
    return this.poseBrain(view, targets, gap, options.fit ?? true, anatomical);
  }

  private poseBrain(
    view: ReportBrainView,
    targets: ReturnType<ReportSceneController['getReportSurfaces']>,
    gap: number,
    fit: boolean,
    anatomical: AnatomicalView | null
  ): ControlCommandResult {
    const reportTarget = this.getViewTarget();
    return this.withMutationBoundary(() => {
      this.changingView = true;
      try {
        layoutReportAnatomicalBrain(
          targets.map(({ id, hemisphere, surface }) => ({
            id,
            hemisphere,
            mesh: surface.mesh!
          })),
          view,
          gap,
          view === 'oblique' ? this.obliqueAngle(targets) : this.oblique
        );
        if (fit) this.fitCamera(targets);
        this.currentBrainView = view;
        this.currentView = anatomical && reportTarget
          ? Object.freeze({ view: anatomical, target: reportTarget })
          : null;
        if (anatomical) {
          this.viewer.emit('anatomical-view:changed', {
            view: anatomical,
            layout: reportTarget?.kind === 'group' ? 'paired' : 'single',
            surfaceIds: Object.freeze(targets.map(surface => surface.id)),
            fit
          });
        }
        this.viewer.requestRender();
      } finally {
        this.changingView = false;
      }
      return SUCCESS;
    });
  }

  /** The oblique angle for the displayed map (data-driven when `oblique: 'auto'`). */
  private obliqueAngle(
    targets: ReturnType<ReportSceneController['getReportSurfaces']>
  ): ReportObliqueAngle {
    if (!this.autoOblique || !this.displayedLayerId) return this.oblique;
    const cached = this.autoObliqueCache.get(this.displayedLayerId);
    if (cached) return cached;
    const angle = chooseInformativeOblique(
      targets.map(({ id, hemisphere, surface }) => {
        const layer = this.viewer.getOrderedLayers(id)
          .find(candidate => candidate.id === this.displayedLayerId);
        return { hemisphere, surface, layer };
      }),
      this.oblique
    );
    this.autoObliqueCache.set(this.displayedLayerId, angle);
    return angle;
  }

  fitView(): ControlCommandResult {
    const unavailable = this.commandUnavailable();
    if (unavailable) return unavailable;
    const targets = this.resolveViewSurfaces();
    if ('ok' in targets) return targets;
    return this.withMutationBoundary(() => {
      this.changingView = true;
      try {
        this.fitCamera(targets);
        this.viewer.emit('camera:changed', {
          camera: this.viewer.camera,
          position: this.viewer.camera.position.clone(),
          target: this.viewer.cameraControls.target.clone()
        });
        this.viewer.requestRender();
      } finally {
        this.changingView = false;
      }
      return SUCCESS;
    });
  }

  resetView(): ControlCommandResult {
    if (this.layout === 'anatomical') return this.setBrainView(this.initialBrainView, { fit: true });
    const target = this.getViewTarget();
    return target
      ? this.setAnatomicalView(this.initialView, target, { fit: true })
      : failure('unsupported', 'No coordinated report view target is available.');
  }

  resizeFit(): void {
    if (this.commandUnavailable()) return;
    const targets = this.resolveViewSurfaces();
    if ('ok' in targets) return;
    this.fitCamera(targets);
  }

  isDisposed(): boolean {
    return this.disposed || this.viewer.isDisposed();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const unsubscribe of this.viewerUnsubscribers.splice(0)) unsubscribe();
    for (const listener of [...this.disposingListeners]) this.deliverDisposing(listener);
    this.disposingListeners.clear();
    this.mutationListeners.clear();
  }

  private commandUnavailable(): ControlCommandResult | null {
    if (this.isDisposed()) {
      return failure('disposed', 'The report scene controller has been disposed.');
    }
    if (this.viewer.initializationFailed) {
      return failure('unsupported', 'The report viewer did not initialize successfully.');
    }
    return null;
  }

  private withMutationBoundary<T>(operation: () => T): T {
    this.mutationDepth += 1;
    if (this.mutationDepth === 1) this.deliverMutationPhase('begin');
    try {
      return operation();
    } finally {
      this.mutationDepth -= 1;
      if (this.mutationDepth === 0) this.deliverMutationPhase('end');
    }
  }

  private deliverMutationPhase(phase: ReportSceneMutationPhase): void {
    for (const listener of [...this.mutationListeners]) {
      try {
        listener(phase);
      } catch {
        // Observer failures must not leave a coordinated scene half-mutated.
      }
    }
  }

  private deliverDisposing(listener: ReportSceneDisposingListener): void {
    try {
      listener();
    } catch {
      // Viewer disposal continues even if an external observer is faulty.
    }
  }

  private getReportSurfaces(): Array<{
    readonly id: string;
    readonly hemisphere: 'left' | 'right';
    readonly surface: MultiLayerNeuroSurface;
  }> {
    return Object.values(this.manifest.geometries).flatMap(geometry => {
      const surface = this.viewer.getSurface(geometry.id);
      return surface
        ? [{ id: geometry.id, hemisphere: geometry.hemisphere, surface: surface as MultiLayerNeuroSurface }]
        : [];
    });
  }

  private resolveViewSurfaces(): ReturnType<ReportSceneController['getReportSurfaces']> |
    ControlCommandResult {
    const reportSurfaces = this.getReportSurfaces();
    const target = this.getViewTarget();
    if (!target) {
      return failure('unsupported', 'No coordinated report view target is available.');
    }
    const ids = target.kind === 'group'
      ? [
          this.options.bilateralGroup!.leftSurfaceId,
          this.options.bilateralGroup!.rightSurfaceId
        ]
      : [target.surfaceId];
    const resolved = ids.flatMap(id => reportSurfaces.filter(surface => surface.id === id));
    if (resolved.length !== ids.length || resolved.some(({ surface }) => !surface.mesh)) {
      return failure('surface-not-found', 'A coordinated report surface is unavailable.');
    }
    return resolved;
  }

  private deriveDisplayedLayerId(): string | null {
    const visible = new Set<string>();
    const surfaceLayers = this.getReportSurfaces().map(({ id }) =>
      this.viewer.getOrderedLayers(id).filter(layer =>
        Object.prototype.hasOwnProperty.call(this.manifest.layers, layer.id)
      )
    );
    for (const layers of surfaceLayers) {
      for (const layer of layers) {
        if (layer.visible) visible.add(layer.id);
      }
    }
    if (visible.size !== 1) return null;
    const candidate = visible.values().next().value as string | undefined;
    if (candidate === undefined) return null;
    return surfaceLayers.every(layers => {
      const candidateLayer = layers.find(layer => layer.id === candidate);
      return (!candidateLayer || candidateLayer.visible) &&
        layers.every(layer => layer.id === candidate || !layer.visible);
    }) ? candidate : null;
  }

  private observeView(event: AnatomicalViewChangedEvent): void {
    if (this.changingView) return;
    const target = this.getViewTarget();
    if (!target) {
      this.currentView = null;
      return;
    }
    const expectedIds = target.kind === 'group'
      ? [
          this.options.bilateralGroup!.leftSurfaceId,
          this.options.bilateralGroup!.rightSurfaceId
        ]
      : [target.surfaceId];
    this.currentView = expectedIds.length === event.surfaceIds.length &&
      expectedIds.every(id => event.surfaceIds.includes(id))
      ? Object.freeze({ view: event.view, target })
      : null;
  }

  private targetsEqual(
    left: AnatomicalViewTargetRef,
    right: AnatomicalViewTargetRef
  ): boolean {
    return left.kind === right.kind && (left.kind === 'surface'
      ? left.surfaceId === (right as { readonly surfaceId: string }).surfaceId
      : left.groupId === (right as { readonly groupId: string }).groupId);
  }

  private fitCamera(targets: ReturnType<ReportSceneController['getReportSurfaces']>): void {
    const bounds = new THREE.Box3();
    for (const { surface } of targets) {
      // Precise (per-vertex) bounds: a rotated geometry AABB overstates the
      // extent of oblique poses and leaves the brain small in the frame.
      if (surface.mesh?.visible) bounds.expandByObject(surface.mesh, true);
    }
    if (bounds.isEmpty()) return;
    const camera = this.viewer.camera;
    const center = bounds.getCenter(new THREE.Vector3());
    const fullWidth = Math.max(1, this.viewer.width || 1);
    const fullHeight = Math.max(1, this.viewer.height || 1);
    const insets = this.fitInsets;
    const freeWidth = Math.max(1, fullWidth - insets.left - insets.right);
    const freeHeight = Math.max(1, fullHeight - insets.top - insets.bottom);
    const tanHalfV = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
    // Half-extent tangents of the free rectangle under the full-canvas frustum.
    const tanFreeV = tanHalfV * freeHeight / fullHeight;
    const tanFreeH = tanHalfV * freeWidth / fullHeight;
    // Exact perspective fit: the camera looks down -z at the box centre, so a
    // vertex (x, y, z) is inside the frame when |x - cx| <= tanH * (D - (z - cz))
    // and likewise for y. The smallest D satisfying every visible vertex frames
    // the silhouette itself rather than its bounding box.
    let distance = 0;
    const point = new THREE.Vector3();
    for (const { surface } of targets) {
      const mesh = surface.mesh;
      if (!mesh?.visible) continue;
      const positions = (mesh.geometry as THREE.BufferGeometry).getAttribute('position');
      if (!positions) continue;
      mesh.updateMatrixWorld(true);
      for (let i = 0; i < positions.count; i++) {
        point.fromBufferAttribute(positions, i).applyMatrix4(mesh.matrixWorld);
        const depth = point.z - center.z;
        distance = Math.max(
          distance,
          Math.abs(point.x - center.x) / tanFreeH + depth,
          Math.abs(point.y - center.y) / tanFreeV + depth
        );
      }
    }
    const paddedDistance = Math.max(distance * (1 + this.fitMargin), 1);
    camera.position.copy(center).add(new THREE.Vector3(0, 0, paddedDistance));
    camera.up.set(0, 1, 0);
    camera.lookAt(center);
    camera.near = Math.max(paddedDistance / 1000, 0.001);
    camera.far = Math.max(paddedDistance * 10, 100);
    // Shift the principal point so the brain centre lands in the middle of the
    // free rectangle while the orbit target stays on the brain.
    const offsetX = (insets.right - insets.left) / 2;
    const offsetY = (insets.bottom - insets.top) / 2;
    if (offsetX !== 0 || offsetY !== 0) {
      camera.setViewOffset(fullWidth, fullHeight, offsetX, offsetY, fullWidth, fullHeight);
    } else if (camera.view) {
      camera.clearViewOffset();
    }
    camera.updateProjectionMatrix();
    this.viewer.cameraControls.target.copy(center);
    this.viewer.cameraControls.update();
  }


}
