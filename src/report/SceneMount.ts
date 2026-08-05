import * as THREE from 'three';
import { NeuroSurfaceViewer } from '../NeuroSurfaceViewer';
import { SurfaceGeometry } from '../classes';
import { MultiLayerNeuroSurface } from '../MultiLayerNeuroSurface';
import { DataLayer } from '../layers';
import type { FigureExportOptions, SurfViewStylePresetName } from '../StylePresets';
import {
  loadSceneAsset,
  validateSceneManifest
} from '../scene';
import type {
  SceneTypedArray,
  SurfViewSceneManifest
} from '../scene';

export type SurfViewSceneView =
  | 'lateral'
  | 'medial'
  | 'dorsal'
  | 'ventral'
  | 'anterior'
  | 'posterior'
  | 'reset';

export interface MountSurfViewOptions {
  /** Delay asset loading and WebGL creation until the container intersects the viewport. */
  lazy?: boolean;
  /** IntersectionObserver root margin used by lazy mounting. */
  rootMargin?: string;
  /** Asset URL base for adjacent-directory manifests. */
  baseUrl?: string;
  /** Fetch implementation used for adjacent assets. */
  fetcher?: typeof fetch;
  /** Initial CSS-pixel width. Defaults to the container width or 640. */
  width?: number;
  /** Initial CSS-pixel height. Defaults to the container height or 480. */
  height?: number;
  /** Viewer appearance preset. `paper-light` is the report default. */
  preset?: SurfViewStylePresetName;
  /** Show the small report toolbar. This never loads Tweakpane. */
  controls?: boolean;
  /** Initial coordinated bilateral view. */
  initialView?: Exclude<SurfViewSceneView, 'reset'>;
  /** Gap between recentered hemispheres in scene units. */
  hemisphereGap?: number;
  /** Called after a load or WebGL initialization failure is rendered inline. */
  onError?: (error: Error) => void;
}

export interface SurfViewMountHandle {
  /** Resolves after assets, surfaces, controls, and the first view are ready. */
  readonly ready: Promise<void>;
  /** The viewer after mounting, or null while lazy/unmounted/disposed. */
  readonly viewer: NeuroSurfaceViewer | null;
  /** The validated manifest used by this mount. */
  readonly manifest: SurfViewSceneManifest;
  selectLayer(layerId: string): void;
  setView(view: SurfViewSceneView): void;
  resize(width?: number, height?: number): void;
  exportPNG(options?: FigureExportOptions): string;
  dispose(): void;
}

interface LoadedSurface {
  id: string;
  hemisphere: 'left' | 'right';
  surface: MultiLayerNeuroSurface;
}

interface ViewAxes {
  direction: THREE.Vector3;
  up: THREE.Vector3;
}

const VIEW_LABELS: Record<Exclude<SurfViewSceneView, 'reset'>, string> = {
  lateral: 'Lateral',
  medial: 'Medial',
  dorsal: 'Dorsal',
  ventral: 'Ventral',
  anterior: 'Anterior',
  posterior: 'Posterior'
};

function abortError(message: string): DOMException {
  return new DOMException(message, 'AbortError');
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function finiteSize(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isFinite(value) && value > 0
    ? value
    : fallback;
}

function axesForView(
  hemisphere: 'left' | 'right',
  view: Exclude<SurfViewSceneView, 'reset'>
): ViewAxes {
  switch (view) {
    case 'lateral':
      return {
        direction: new THREE.Vector3(hemisphere === 'left' ? -1 : 1, 0, 0),
        up: new THREE.Vector3(0, 0, 1)
      };
    case 'medial':
      return {
        direction: new THREE.Vector3(hemisphere === 'left' ? 1 : -1, 0, 0),
        up: new THREE.Vector3(0, 0, 1)
      };
    case 'dorsal':
      return { direction: new THREE.Vector3(0, 0, 1), up: new THREE.Vector3(0, 1, 0) };
    case 'ventral':
      return { direction: new THREE.Vector3(0, 0, -1), up: new THREE.Vector3(0, 1, 0) };
    case 'anterior':
      return { direction: new THREE.Vector3(0, 1, 0), up: new THREE.Vector3(0, 0, 1) };
    case 'posterior':
      return { direction: new THREE.Vector3(0, -1, 0), up: new THREE.Vector3(0, 0, 1) };
  }
}

function viewQuaternion(axes: ViewAxes): THREE.Quaternion {
  const sourceForward = axes.direction.clone().normalize();
  const sourceUp = axes.up.clone().normalize();
  const sourceRight = sourceUp.clone().cross(sourceForward).normalize();
  sourceUp.copy(sourceForward).cross(sourceRight).normalize();

  const sourceBasis = new THREE.Matrix4().makeBasis(
    sourceRight,
    sourceUp,
    sourceForward
  );
  const sourceInverse = sourceBasis.clone().invert();
  return new THREE.Quaternion().setFromRotationMatrix(sourceInverse);
}

class ReportControls {
  readonly element: HTMLDivElement;
  private readonly events = new AbortController();
  private readonly select: HTMLSelectElement;
  private readonly legend: HTMLSpanElement;
  private readonly viewButtons = new Map<string, HTMLButtonElement>();

  constructor(
    manifest: SurfViewSceneManifest,
    selectedLayer: string,
    selectedView: Exclude<SurfViewSceneView, 'reset'>,
    callbacks: {
      selectLayer: (id: string) => void;
      setView: (view: SurfViewSceneView) => void;
      exportPNG: () => void;
    }
  ) {
    this.element = document.createElement('div');
    this.element.className = 'surfview-report-controls';
    this.element.setAttribute('role', 'toolbar');
    this.element.setAttribute('aria-label', 'Surface report controls');
    Object.assign(this.element.style, {
      alignItems: 'center',
      background: '#f8fafc',
      border: '1px solid #d7dde5',
      borderRadius: '6px',
      color: '#111827',
      display: 'flex',
      flexWrap: 'wrap',
      font: '12px/1.4 system-ui, sans-serif',
      gap: '6px',
      marginBottom: '8px',
      padding: '7px'
    });

    const label = document.createElement('label');
    label.textContent = 'Map ';
    this.select = document.createElement('select');
    this.select.setAttribute('aria-label', 'Displayed surface map');
    for (const layer of Object.values(manifest.layers)) {
      const option = document.createElement('option');
      option.value = layer.id;
      option.textContent = layer.label ?? layer.id;
      this.select.appendChild(option);
    }
    this.select.value = selectedLayer;
    this.select.addEventListener(
      'change',
      () => callbacks.selectLayer(this.select.value),
      { signal: this.events.signal }
    );
    label.appendChild(this.select);
    this.element.appendChild(label);

    for (const [view, text] of Object.entries(VIEW_LABELS)) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = text;
      button.dataset.view = view;
      button.setAttribute('aria-pressed', String(view === selectedView));
      button.addEventListener(
        'click',
        () => callbacks.setView(view as SurfViewSceneView),
        { signal: this.events.signal }
      );
      this.viewButtons.set(view, button);
      this.element.appendChild(button);
    }

    const reset = document.createElement('button');
    reset.type = 'button';
    reset.textContent = 'Reset';
    reset.addEventListener('click', () => callbacks.setView('reset'), {
      signal: this.events.signal
    });
    this.element.appendChild(reset);

    const download = document.createElement('button');
    download.type = 'button';
    download.textContent = 'PNG';
    download.setAttribute('aria-label', 'Export surface view as PNG');
    download.addEventListener('click', callbacks.exportPNG, {
      signal: this.events.signal
    });
    this.element.appendChild(download);

    this.legend = document.createElement('span');
    this.legend.setAttribute('aria-live', 'polite');
    this.legend.style.marginLeft = 'auto';
    this.element.appendChild(this.legend);
    this.updateLegend(manifest.layers[selectedLayer]);
  }

  updateLegend(layer: SurfViewSceneManifest['layers'][string]): void {
    this.select.value = layer.id;
    const title = layer.legend?.title ?? layer.label ?? layer.id;
    const unitLabel = layer.legend?.units ?? layer.units;
    const units = unitLabel ? ` ${unitLabel}` : '';
    this.legend.textContent = `${title}: ${layer.limits[0]} to ${layer.limits[1]}${units}`;
    this.legend.hidden = layer.legend?.visible === false;
  }

  updateView(view: Exclude<SurfViewSceneView, 'reset'>): void {
    this.viewButtons.forEach((button, key) => {
      button.setAttribute('aria-pressed', String(key === view));
    });
  }

  dispose(): void {
    this.events.abort();
    this.element.remove();
  }
}

class SceneMount implements SurfViewMountHandle {
  readonly ready: Promise<void>;
  readonly manifest: SurfViewSceneManifest;

  private readonly container: HTMLElement;
  private readonly options: Required<Pick<MountSurfViewOptions,
    'lazy' | 'rootMargin' | 'preset' | 'controls' | 'initialView' | 'hemisphereGap'>> &
    MountSurfViewOptions;
  private readonly abortController = new AbortController();
  private readonly root: HTMLDivElement;
  private readonly stage: HTMLDivElement;
  private readonly status: HTMLDivElement;
  private readonly surfaces: LoadedSurface[] = [];
  private observer: IntersectionObserver | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private reportControls: ReportControls | null = null;
  private currentViewer: NeuroSurfaceViewer | null = null;
  private mounted = false;
  private mounting = false;
  private disposed = false;
  private selectedLayer: string;
  private selectedView: Exclude<SurfViewSceneView, 'reset'>;
  private resolveReady!: () => void;
  private rejectReady!: (error: Error) => void;

  constructor(
    container: HTMLElement,
    manifest: SurfViewSceneManifest,
    options: MountSurfViewOptions
  ) {
    this.container = container;
    this.manifest = manifest;
    this.options = {
      ...options,
      lazy: options.lazy ?? true,
      rootMargin: options.rootMargin ?? '128px',
      preset: options.preset ?? 'paper-light',
      controls: options.controls ?? true,
      initialView: options.initialView ?? 'lateral',
      hemisphereGap: options.hemisphereGap ?? 8
    };
    this.selectedLayer = manifest.selectedLayer ??
      Object.values(manifest.layers).find(layer => layer.visible)?.id ??
      Object.keys(manifest.layers)[0] ?? '';
    this.selectedView = this.options.initialView;

    this.ready = new Promise<void>((resolve, reject) => {
      this.resolveReady = resolve;
      this.rejectReady = reject;
    });

    this.root = document.createElement('div');
    this.root.className = 'surfview-mount';
    this.root.dataset.sceneId = manifest.id;
    this.root.style.position = 'relative';
    this.root.style.width = '100%';

    this.stage = document.createElement('div');
    this.stage.className = 'surfview-stage';
    this.stage.style.minHeight = `${finiteSize(options.height, 480)}px`;
    this.stage.style.position = 'relative';
    this.stage.style.width = '100%';

    this.status = document.createElement('div');
    this.status.className = 'surfview-status';
    this.status.setAttribute('role', 'status');
    this.status.textContent = this.options.lazy
      ? 'Surface view will load when visible.'
      : 'Loading surface view…';
    Object.assign(this.status.style, {
      alignItems: 'center',
      background: '#f8fafc',
      color: '#475569',
      display: 'flex',
      font: '13px/1.5 system-ui, sans-serif',
      inset: '0',
      justifyContent: 'center',
      padding: '1rem',
      position: 'absolute',
      textAlign: 'center'
    });
    this.stage.appendChild(this.status);
    this.root.appendChild(this.stage);
    container.appendChild(this.root);

    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(entries => {
        const width = entries[0]?.contentRect.width;
        if (width && this.currentViewer) {
          this.resize(
            width,
            this.options.height ?? finiteSize(this.stage.getBoundingClientRect().height, 480)
          );
        }
      });
      this.resizeObserver.observe(container);
    }

    if (this.options.lazy && typeof IntersectionObserver !== 'undefined') {
      this.observer = new IntersectionObserver(entries => {
        if (entries.some(entry => entry.isIntersecting)) {
          this.observer?.disconnect();
          this.observer = null;
          void this.mount();
        }
      }, { rootMargin: this.options.rootMargin });
      this.observer.observe(this.root);
    } else {
      void this.mount();
    }
  }

  get viewer(): NeuroSurfaceViewer | null {
    return this.currentViewer;
  }

  selectLayer(layerId: string): void {
    const layer = this.manifest.layers[layerId];
    if (!layer) throw new Error(`Unknown scene layer: ${layerId}`);
    this.selectedLayer = layerId;
    if (!this.mounted || !this.currentViewer) return;
    for (const { id, surface } of this.surfaces) {
      for (const candidate of Object.keys(this.manifest.layers)) {
        if (surface.layerStack.getLayer(candidate)) {
          this.currentViewer.updateLayerVisibility(id, candidate, candidate === layerId);
        }
      }
    }
    this.currentViewer.selectedLayerId = layerId;
    this.reportControls?.updateLegend(layer);
  }

  setView(view: SurfViewSceneView): void {
    const resolved = view === 'reset' ? this.options.initialView : view;
    this.selectedView = resolved;
    if (!this.mounted || !this.currentViewer) return;

    const dimensions = new Map<string, THREE.Vector3>();
    for (const loaded of this.surfaces) {
      const mesh = loaded.surface.mesh;
      if (!mesh) continue;
      mesh.position.set(0, 0, 0);
      mesh.quaternion.copy(viewQuaternion(axesForView(loaded.hemisphere, resolved)));
      mesh.updateMatrixWorld(true);
      dimensions.set(loaded.id, new THREE.Box3().setFromObject(mesh).getSize(new THREE.Vector3()));
    }

    const left = this.surfaces.find(surface => surface.hemisphere === 'left');
    const right = this.surfaces.find(surface => surface.hemisphere === 'right');
    for (const loaded of this.surfaces) {
      const mesh = loaded.surface.mesh;
      if (!mesh) continue;
      const center = new THREE.Box3().setFromObject(mesh).getCenter(new THREE.Vector3());
      mesh.position.sub(center);
      if (left && right) {
        const ownWidth = dimensions.get(loaded.id)?.x ?? 0;
        mesh.position.x += loaded.hemisphere === 'left'
          ? -(ownWidth / 2 + this.options.hemisphereGap / 2)
          : ownWidth / 2 + this.options.hemisphereGap / 2;
      }
      mesh.updateMatrixWorld(true);
    }
    this.fitCamera();
    this.currentViewer.requestRender();
    this.reportControls?.updateView(resolved);
  }

  resize(width?: number, height?: number): void {
    const measured = this.container.getBoundingClientRect();
    const nextWidth = finiteSize(width, finiteSize(measured.width, this.options.width ?? 640));
    const nextHeight = finiteSize(height, finiteSize(measured.height, this.options.height ?? 480));
    this.stage.style.minHeight = `${nextHeight}px`;
    if (this.currentViewer) {
      this.currentViewer.resize(nextWidth, nextHeight);
      this.fitCamera();
    }
  }

  exportPNG(options: FigureExportOptions = {}): string {
    if (!this.currentViewer || !this.mounted) {
      throw new Error('Surface view is not mounted');
    }
    return this.currentViewer.exportPNG(options);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.abortController.abort();
    this.observer?.disconnect();
    this.observer = null;
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.reportControls?.dispose();
    this.reportControls = null;
    this.currentViewer?.dispose();
    this.currentViewer = null;
    this.surfaces.length = 0;
    this.root.remove();
    if (!this.mounted) {
      this.rejectReady(abortError('Surface view was disposed before it mounted'));
    }
  }

  private async mount(): Promise<void> {
    if (this.mounting || this.mounted || this.disposed) return;
    this.mounting = true;
    this.status.textContent = 'Loading surface view…';
    try {
      const assets = await this.loadAssets();
      if (this.disposed) throw abortError('Surface view was disposed while loading');

      const measured = this.container.getBoundingClientRect();
      const width = finiteSize(this.options.width, finiteSize(measured.width, 640));
      const height = finiteSize(this.options.height, finiteSize(measured.height, 480));
      this.stage.style.minHeight = `${height}px`;
      const viewer = new NeuroSurfaceViewer(
        this.stage,
        width,
        height,
        {
          preset: this.options.preset,
          showControls: false,
          useControls: false,
          allowCDNFallback: false
        },
        'lateral'
      );
      if (viewer.initializationFailed) {
        viewer.dispose();
        throw new Error('WebGL is unavailable; the surface view could not be initialized.');
      }
      this.currentViewer = viewer;
      this.buildSurfaces(assets);
      this.mounted = true;
      this.status.remove();

      if (this.options.controls) {
        this.reportControls = new ReportControls(
          this.manifest,
          this.selectedLayer,
          this.selectedView,
          {
            selectLayer: layerId => this.selectLayer(layerId),
            setView: view => this.setView(view),
            exportPNG: () => this.downloadPNG()
          }
        );
        this.root.insertBefore(this.reportControls.element, this.stage);
      }
      this.selectLayer(this.selectedLayer);
      this.setView(this.selectedView);
      this.resolveReady();
    } catch (error) {
      if (this.disposed && asError(error).name === 'AbortError') return;
      const failure = asError(error);
      this.renderError(failure);
      this.rejectReady(failure);
    } finally {
      this.mounting = false;
    }
  }

  private async loadAssets(): Promise<Map<string, SceneTypedArray>> {
    const loaded = new Map<string, SceneTypedArray>();
    await Promise.all(Object.values(this.manifest.assets).map(async descriptor => {
      const values = await loadSceneAsset(descriptor, {
        signal: this.abortController.signal,
        fetcher: this.options.fetcher,
        baseUrl: this.options.baseUrl
      });
      loaded.set(descriptor.id, values);
    }));
    return loaded;
  }

  private buildSurfaces(assets: Map<string, SceneTypedArray>): void {
    if (!this.currentViewer) throw new Error('Viewer was not initialized');
    for (const geometryManifest of Object.values(this.manifest.geometries)) {
      const vertices = this.requireFloat32(assets, geometryManifest.vertices);
      const faces = this.requireUint32(assets, geometryManifest.faces);
      const curvature = geometryManifest.curvature
        ? this.requireFloat32(assets, geometryManifest.curvature)
        : null;
      for (let index = 0; index < faces.length; index += 1) {
        if (faces[index] >= geometryManifest.vertexCount) {
          throw new Error(
            `Geometry ${geometryManifest.id} face index ${faces[index]} exceeds vertex count`
          );
        }
      }
      const geometry = new SurfaceGeometry(
        vertices,
        faces,
        geometryManifest.hemisphere,
        curvature,
        false
      );
      const surface = new MultiLayerNeuroSurface(geometry, {
        curvature: curvature ?? undefined,
        showCurvature: Boolean(curvature),
        useGPUCompositing: false
      });

      for (const layerManifest of Object.values(this.manifest.layers)) {
        const valueManifest = layerManifest.values[geometryManifest.id];
        if (!valueManifest) continue;
        const values = this.requireFloat32(assets, valueManifest.values);
        const indices = valueManifest.indices
          ? this.requireUint32(assets, valueManifest.indices)
          : null;
        if (indices) {
          for (let index = 0; index < indices.length; index += 1) {
            if (indices[index] >= geometryManifest.vertexCount) {
              throw new Error(
                `Layer ${layerManifest.id} index ${indices[index]} exceeds vertex count`
              );
            }
          }
        }
        surface.addLayer(new DataLayer(
          layerManifest.id,
          values,
          indices,
          layerManifest.colorMap,
          {
            range: layerManifest.limits,
            threshold: layerManifest.threshold,
            opacity: layerManifest.opacity ?? 1,
            visible: layerManifest.id === this.selectedLayer
          }
        ));
      }
      this.currentViewer.addSurface(surface, geometryManifest.id);
      this.surfaces.push({
        id: geometryManifest.id,
        hemisphere: geometryManifest.hemisphere,
        surface
      });
    }
  }

  private requireFloat32(
    assets: Map<string, SceneTypedArray>,
    id: string
  ): Float32Array {
    const values = assets.get(id);
    if (!(values instanceof Float32Array)) {
      throw new Error(`Asset ${id} was not loaded as Float32Array`);
    }
    return values;
  }

  private requireUint32(
    assets: Map<string, SceneTypedArray>,
    id: string
  ): Uint32Array {
    const values = assets.get(id);
    if (!(values instanceof Uint32Array)) {
      throw new Error(`Asset ${id} was not loaded as Uint32Array`);
    }
    return values;
  }

  private fitCamera(): void {
    const viewer = this.currentViewer;
    if (!viewer) return;
    const bounds = new THREE.Box3();
    for (const { surface } of this.surfaces) {
      if (surface.mesh) bounds.expandByObject(surface.mesh);
    }
    if (bounds.isEmpty()) return;
    const center = bounds.getCenter(new THREE.Vector3());
    const size = bounds.getSize(new THREE.Vector3());
    const verticalFov = THREE.MathUtils.degToRad(viewer.camera.fov);
    const horizontalFov = 2 * Math.atan(Math.tan(verticalFov / 2) * viewer.camera.aspect);
    const distance = Math.max(
      size.y / (2 * Math.tan(verticalFov / 2)),
      size.x / (2 * Math.tan(horizontalFov / 2))
    ) + size.z / 2;
    const paddedDistance = Math.max(distance * 1.12, 1);
    viewer.camera.position.copy(center).add(new THREE.Vector3(0, 0, paddedDistance));
    viewer.camera.up.set(0, 1, 0);
    viewer.camera.lookAt(center);
    viewer.camera.near = Math.max(paddedDistance / 1000, 0.001);
    viewer.camera.far = Math.max(paddedDistance * 10, 100);
    viewer.camera.updateProjectionMatrix();
    viewer.controls.target.copy(center);
    viewer.controls.update();
  }

  private downloadPNG(): void {
    const dataUrl = this.exportPNG({ preset: this.options.preset });
    const anchor = document.createElement('a');
    anchor.href = dataUrl;
    anchor.download = `${this.manifest.id}.png`;
    anchor.click();
  }

  private renderError(error: Error): void {
    this.currentViewer?.dispose();
    this.currentViewer = null;
    this.status.setAttribute('role', 'alert');
    this.status.style.color = '#991b1b';
    this.status.style.background = '#fef2f2';
    this.status.textContent = `Surface view unavailable: ${error.message}`;
    if (!this.status.isConnected) this.stage.appendChild(this.status);
    this.options.onError?.(error);
  }
}

/**
 * Mount a portable SurfView scene into an ordinary DOM element.
 *
 * Validation is synchronous and happens before an observer, fetch, animation
 * frame, or WebGL context is created. Runtime failures are also rendered in the
 * mount so knitted/static reports never degrade to an unexplained blank panel.
 */
export function mountSurfView(
  container: HTMLElement,
  manifest: SurfViewSceneManifest,
  options: MountSurfViewOptions = {}
): SurfViewMountHandle {
  if (!(container instanceof HTMLElement)) {
    throw new TypeError('mountSurfView requires an HTMLElement container');
  }
  validateSceneManifest(manifest);
  return new SceneMount(container, manifest, options);
}
