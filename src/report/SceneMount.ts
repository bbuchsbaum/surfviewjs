import { NeuroSurfaceViewer } from '../NeuroSurfaceViewer';
import { SurfaceGeometry } from '../classes';
import { MultiLayerNeuroSurface } from '../MultiLayerNeuroSurface';
import { DataLayer } from '../layers';
import type { FigureExportOptions, SurfViewStylePresetName } from '../StylePresets';
import {
  ANATOMICAL_VIEWS,
  freezeBilateralSurfaceGroup
} from '../AnatomicalView';
import type {
  AnatomicalView,
  AnatomicalViewCapabilities,
  BilateralSurfaceGroup
} from '../AnatomicalView';
import type {
  SurfViewControlTarget
} from '../controls';
import {
  loadSceneAsset,
  validateSceneManifest
} from '../scene';
import type {
  SceneTypedArray,
  SurfViewSceneManifest
} from '../scene';
import {
  ReportSceneController
} from './ReportSceneController';
import {
  createReportSceneControlTarget,
  ReportSceneControlTarget
} from './ReportSceneControlTarget';
import { ReportControls } from './ReportControls';

export { layoutReportAnatomicalMeshes } from './ReportSceneController';
export type { ReportAnatomicalMesh } from './ReportSceneController';

export type SurfViewSceneView = AnatomicalView | 'reset';

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
  /** Show the small report toolbar. This never loads an external pane UI. */
  controls?: boolean;
  /** Initial anatomical view. */
  initialView?: AnatomicalView;
  /**
   * Explicit pair controlled by coordinated report views. Required when a
   * report contains more than one surface; pairs are never inferred.
   */
  bilateralGroup?: BilateralSurfaceGroup;
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
  /** The report-aware target after mounting, or null while lazy/unmounted/disposed. */
  readonly controlTarget: SurfViewControlTarget | null;
  /** The validated manifest used by this mount. */
  readonly manifest: SurfViewSceneManifest;
  selectLayer(layerId: string): void;
  /** @deprecated Passing "reset" remains supported; prefer resetView(). */
  setView(view: SurfViewSceneView): void;
  /** Restore the configured initial anatomical view. */
  resetView(): void;
  getAnatomicalViewCapabilities(): AnatomicalViewCapabilities;
  resize(width?: number, height?: number): void;
  exportPNG(options?: FigureExportOptions): string;
  dispose(): void;
}

interface LoadedSurface {
  id: string;
  hemisphere: 'left' | 'right';
  surface: MultiLayerNeuroSurface;
}

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
  private reportController: ReportSceneController | null = null;
  private reportTarget: ReportSceneControlTarget | null = null;
  private mounted = false;
  private mounting = false;
  private disposed = false;
  private selectedLayer: string;
  private selectedView: AnatomicalView;
  private viewGroup: BilateralSurfaceGroup | null = null;
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
      hemisphereGap: options.hemisphereGap ?? 8,
      bilateralGroup: options.bilateralGroup
        ? freezeBilateralSurfaceGroup(options.bilateralGroup)
        : undefined
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

  get controlTarget(): SurfViewControlTarget | null {
    return this.reportTarget;
  }

  selectLayer(layerId: string): void {
    const layer = this.manifest.layers[layerId];
    if (!layer) throw new Error(`Unknown scene layer: ${layerId}`);
    this.selectedLayer = layerId;
    if (!this.mounted || !this.reportTarget) return;
    const result = this.reportTarget.setDisplayedLayer(layerId);
    if (!result.ok) {
      throw new Error(result.message);
    }
  }

  setView(view: SurfViewSceneView): void {
    if (view === 'reset') {
      this.resetView();
      return;
    }
    this.selectedView = view;
    if (!this.mounted || !this.reportTarget || !this.reportController) return;
    const target = this.reportController.getViewTarget();
    if (!target) {
      throw new Error('Multiple report surfaces require an explicit bilateralGroup option');
    }
    const result = this.reportTarget.setAnatomicalView({
      view,
      target,
      fit: true
    });
    if (!result.ok) throw new Error(result.message);
  }

  resetView(): void {
    this.setView(this.options.initialView);
  }

  getAnatomicalViewCapabilities(): AnatomicalViewCapabilities {
    if (this.currentViewer) return this.currentViewer.getAnatomicalViewCapabilities();
    const surfaceIds = Object.keys(this.manifest.geometries).sort();
    return Object.freeze({
      views: ANATOMICAL_VIEWS,
      singleSurfaceIds: Object.freeze(surfaceIds),
      bilateralGroups: Object.freeze(
        this.options.bilateralGroup ? [this.options.bilateralGroup] : []
      )
    });
  }

  resize(width?: number, height?: number): void {
    const measured = this.container.getBoundingClientRect();
    const nextWidth = finiteSize(width, finiteSize(measured.width, this.options.width ?? 640));
    const nextHeight = finiteSize(height, finiteSize(measured.height, this.options.height ?? 480));
    this.stage.style.minHeight = `${nextHeight}px`;
    if (this.currentViewer) {
      this.currentViewer.resize(nextWidth, nextHeight);
      this.reportController?.resizeFit();
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
    this.reportTarget?.dispose();
    this.reportTarget = null;
    this.reportController?.dispose();
    this.reportController = null;
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
          preset: this.options.preset
        },
        'lateral'
      );
      if (viewer.initializationFailed) {
        viewer.dispose();
        throw new Error('WebGL is unavailable; the surface view could not be initialized.');
      }
      this.currentViewer = viewer;
      this.buildSurfaces(assets);
      this.reportController = new ReportSceneController(viewer, this.manifest, {
        ...(this.viewGroup ? { bilateralGroup: this.viewGroup } : {}),
        initialView: this.options.initialView,
        hemisphereGap: this.options.hemisphereGap
      });
      this.reportTarget = createReportSceneControlTarget(this.reportController);
      this.mounted = true;
      this.status.remove();

      this.selectLayer(this.selectedLayer);
      this.setView(this.selectedView);

      if (this.options.controls) {
        this.reportControls = new ReportControls(
          this.reportTarget,
          { filename: `${this.manifest.id}.png` }
        );
        this.root.insertBefore(this.reportControls.element, this.stage);
      }
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

    if (this.surfaces.length > 1) {
      if (!this.options.bilateralGroup) {
        throw new Error('Multiple report surfaces require an explicit bilateralGroup option');
      }
      const registration = this.currentViewer.registerBilateralSurfaceGroup(
        this.options.bilateralGroup
      );
      if (!registration.ok) {
        throw new Error(`Invalid report bilateralGroup: ${registration.message}`);
      }
      this.viewGroup = registration.group;
    } else if (this.options.bilateralGroup) {
      const registration = this.currentViewer.registerBilateralSurfaceGroup(
        this.options.bilateralGroup
      );
      if (!registration.ok) {
        throw new Error(`Invalid report bilateralGroup: ${registration.message}`);
      }
      this.viewGroup = registration.group;
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

  private renderError(error: Error): void {
    this.reportControls?.dispose();
    this.reportControls = null;
    this.reportTarget?.dispose();
    this.reportTarget = null;
    this.reportController?.dispose();
    this.reportController = null;
    this.currentViewer?.dispose();
    this.currentViewer = null;
    this.surfaces.length = 0;
    this.viewGroup = null;
    this.mounted = false;
    this.status.setAttribute('role', 'alert');
    this.status.style.color = '#991b1b';
    this.status.style.background = '#fef2f2';
    this.status.textContent = `Surface view unavailable: ${error.message}`;
    if (!this.status.isConnected) this.stage.appendChild(this.status);
    try {
      this.options.onError?.(error);
    } catch {
      // Observer failures must not replace the mount failure or leave ready pending.
    }
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
