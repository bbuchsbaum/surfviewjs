import * as THREE from 'three';
import { NeuroSurfaceViewer } from '@src/index.js';

type NeuroSurfaceViewerConfig = NonNullable<ConstructorParameters<typeof NeuroSurfaceViewer>[3]>;

/** The film base the viewer renders onto: the darkest exposure step of the room. */
export const FILM_BASE = 0x0b1118;

export type Corner = 'tl' | 'tr' | 'bl' | 'br';

/**
 * Scan-style overlay printed on the film sheet: four corners of labelled lines and
 * anatomical orientation letters at the edges. Owned by the shell; chapters write to it.
 */
export class FilmOverlay {
  private readonly corners = new Map<Corner, HTMLElement>();
  private readonly lines = new Map<string, HTMLElement>();
  private readonly edges: Record<'left' | 'right' | 'top' | 'bottom', HTMLElement>;
  private orientationTimer: number | null = null;
  /** Narrow films print the top-right lines as a continuation of the top-left column. */
  private readonly narrow = window.matchMedia('(max-width: 620px)');
  private lastOrientation = '';

  constructor(private readonly root: HTMLElement) {
    for (const corner of ['tl', 'tr', 'bl', 'br'] as const) {
      const element = document.createElement('div');
      element.className = `film-corner film-corner-${corner}`;
      root.append(element);
      this.corners.set(corner, element);
    }
    const edge = (side: string) => {
      const element = document.createElement('span');
      element.className = `film-orient film-orient-${side}`;
      element.setAttribute('aria-hidden', 'true');
      root.append(element);
      return element;
    };
    this.edges = { left: edge('left'), right: edge('right'), top: edge('top'), bottom: edge('bottom') };
    this.narrow.addEventListener('change', () => this.reflowTopRight());
  }

  private hostOf(corner: Corner): HTMLElement {
    return this.corners.get(corner === 'tr' && this.narrow.matches ? 'tl' : corner)!;
  }

  private reflowTopRight(): void {
    const host = this.hostOf('tr');
    for (const [id, line] of this.lines) if (id.startsWith('tr:')) host.append(line);
  }

  /**
   * Print one labelled line into a corner. The same key updates in place and flashes
   * one exposure step brighter; `null` removes it.
   */
  set(corner: Corner, key: string, label: string, value?: string | null): void {
    const id = `${corner}:${key}`;
    let line = this.lines.get(id);
    if (value === null) {
      line?.remove();
      this.lines.delete(id);
      return;
    }
    if (!line) {
      line = document.createElement('div');
      line.className = 'film-line';
      line.dataset.key = key;
      line.innerHTML = '<span class="film-line-label"></span><span class="film-line-value"></span>';
      line.dataset.corner = corner;
      this.hostOf(corner).append(line);
      this.lines.set(id, line);
    }
    const labelEl = line.firstElementChild as HTMLElement;
    const valueEl = line.lastElementChild as HTMLElement;
    const text = value ?? '';
    if (labelEl.textContent !== label) labelEl.textContent = label;
    if (valueEl.textContent !== text) {
      valueEl.textContent = text;
      line.classList.remove('film-line-exposed');
      void line.offsetWidth;
      line.classList.add('film-line-exposed');
    }
  }

  clear(): void {
    for (const line of this.lines.values()) line.remove();
    this.lines.clear();
    this.trackOrientation(null);
  }

  /** Keep the edge letters (L R A P S I) aligned with the camera, or hide them. */
  trackOrientation(viewer: NeuroSurfaceViewer | null): void {
    if (this.orientationTimer !== null) window.clearInterval(this.orientationTimer);
    this.orientationTimer = null;
    this.lastOrientation = '';
    this.root.classList.toggle('film-oriented', viewer !== null);
    if (!viewer) return;
    const update = () => {
      const camera = viewer.camera;
      if (!camera) return;
      camera.updateMatrixWorld();
      const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
      const up = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1);
      const letters = {
        left: orientationLabel(right.clone().negate()),
        right: orientationLabel(right),
        top: orientationLabel(up),
        bottom: orientationLabel(up.clone().negate())
      };
      const signature = Object.values(letters).join('|');
      if (signature === this.lastOrientation) return;
      this.lastOrientation = signature;
      for (const side of ['left', 'right', 'top', 'bottom'] as const) this.edges[side].textContent = letters[side];
    };
    update();
    this.orientationTimer = window.setInterval(update, 200);
  }
}

/** RAS world axis letter(s) for a direction: one letter when dominant, else the two strongest. */
export function orientationLabel(direction: THREE.Vector3): string {
  const axes = [
    { value: direction.x, positive: 'R', negative: 'L' },
    { value: direction.y, positive: 'A', negative: 'P' },
    { value: direction.z, positive: 'S', negative: 'I' }
  ].sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
  const letter = (axis: (typeof axes)[number]) => (axis.value >= 0 ? axis.positive : axis.negative);
  return Math.abs(axes[0]!.value) > 0.85 ? letter(axes[0]!) : letter(axes[0]!) + letter(axes[1]!);
}

export interface FilmViewer {
  viewer: NeuroSurfaceViewer;
  cleanup: () => void;
}

/**
 * A NeuroSurfaceViewer that fills `mount` and follows its size. Chapters use this rather
 * than constructing the viewer themselves so every film shares one base and lighting.
 */
export function createFilmViewer(
  mount: HTMLElement,
  config: Partial<NeuroSurfaceViewerConfig> & { viewpoint?: string } = {}
): FilmViewer {
  const host = document.createElement('div');
  host.className = 'film-viewer';
  mount.replaceChildren(host);
  const width = Math.max(1, host.clientWidth || mount.clientWidth || 960);
  const height = Math.max(1, host.clientHeight || mount.clientHeight || 640);
  const { viewpoint, ...viewerConfig } = config;
  const viewer = new NeuroSurfaceViewer(
    host,
    width,
    height,
    { backgroundColor: FILM_BASE, preset: 'presentation', ...viewerConfig },
    viewpoint ?? 'lateral'
  );
  viewer.startRenderLoop();

  let frame = 0;
  const observer = new ResizeObserver(() => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      const w = Math.round(host.clientWidth), h = Math.round(host.clientHeight);
      if (w > 0 && h > 0 && (w !== viewer.width || h !== viewer.height)) viewer.resize(w, h);
    });
  });
  observer.observe(host);

  return {
    viewer,
    cleanup: () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      viewer.dispose();
    }
  };
}
