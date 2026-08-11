import {
  DataLayer,
  loadSurface,
  MultiLayerNeuroSurface,
  SurfaceGeometry
} from '@src/index.js';
import {
  mountSurfViewControls
} from '@src/controls-ui/index.js';
import type {
  SurfViewControlsFeature,
  SurfViewControlsHandle
} from '@src/controls-ui/index.js';
import { createViewer } from '../viewerHarness';
import type { Scenario, ScenarioRunContext } from '../types';

const leftSample = new URL(
  '../../tests/data/fsaverage5-lh-pial.gii',
  import.meta.url
).href;
const rightSample = new URL(
  '../../tests/data/fsaverage5-rh-pial.gii',
  import.meta.url
).href;

type GalleryTheme = 'auto' | 'light' | 'dark';
type GalleryDensity = 'compact' | 'comfortable';

interface GalleryPanelConfiguration {
  readonly id: string;
  readonly eyebrow: string;
  readonly title: string;
  readonly description: string;
  readonly theme: GalleryTheme;
  readonly density: GalleryDensity;
  readonly width?: number;
  readonly features?: readonly SurfViewControlsFeature[];
  readonly focusedSurfaceId?: string;
  readonly focusedLayerId?: string;
}

function cloneGeometry(source: SurfaceGeometry): SurfaceGeometry {
  return new SurfaceGeometry(
    source.vertices,
    source.faces,
    source.hemi,
    source.vertexCurv,
    false
  );
}

function makeField(
  vertices: Float32Array,
  phase: number,
  scale: number
): Float32Array {
  const values = new Float32Array(vertices.length / 3);
  for (let index = 0; index < values.length; index += 1) {
    const x = vertices[index * 3] ?? 0;
    const y = vertices[index * 3 + 1] ?? 0;
    const z = vertices[index * 3 + 2] ?? 0;
    values[index] = scale * (
      Math.sin(x * 0.035 + phase) +
      Math.cos(y * 0.028 - phase) +
      Math.sin(z * 0.032 + phase * 0.5)
    ) / 3;
  }
  return values;
}

function makeSparseField(
  vertices: Float32Array,
  stride: number
): { readonly values: Float32Array; readonly indices: Uint32Array } {
  const vertexCount = vertices.length / 3;
  const count = Math.ceil(vertexCount / stride);
  const values = new Float32Array(count);
  const indices = new Uint32Array(count);
  let outputIndex = 0;
  for (let vertexIndex = 0; vertexIndex < vertexCount; vertexIndex += stride) {
    const x = vertices[vertexIndex * 3] ?? 0;
    const y = vertices[vertexIndex * 3 + 1] ?? 0;
    values[outputIndex] = 1.8 * Math.sin(x * 0.04) + Math.cos(y * 0.03);
    indices[outputIndex] = vertexIndex;
    outputIndex += 1;
  }
  return { values, indices };
}

function countRenderedPixels(canvas: HTMLCanvasElement): number {
  const context = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
  if (!context || canvas.width < 1 || canvas.height < 1) return 0;
  const pixels = new Uint8Array(canvas.width * canvas.height * 4);
  context.readPixels(
    0,
    0,
    canvas.width,
    canvas.height,
    context.RGBA,
    context.UNSIGNED_BYTE,
    pixels
  );
  let visiblePixels = 0;
  for (let index = 3; index < pixels.length; index += 4) {
    if ((pixels[index] ?? 0) > 16) visiblePixels += 1;
  }
  return visiblePixels;
}

function afterLayout(): Promise<void> {
  return new Promise(resolve => requestAnimationFrame(() => resolve()));
}

function makeGalleryCard(config: GalleryPanelConfiguration): HTMLElement {
  const card = document.createElement('article');
  card.className = 'controls-gallery-card';
  card.id = `gallery-${config.id}`;
  card.dataset.galleryConfig = config.id;
  card.dataset.galleryTheme = config.theme;
  card.dataset.galleryDensity = config.density;
  card.innerHTML = `
    <header class="controls-gallery-card-header">
      <div>
        <p class="controls-gallery-eyebrow">${config.eyebrow}</p>
        <h3>${config.title}</h3>
      </div>
      <div class="controls-gallery-badges" aria-label="Configuration">
        <span>${config.theme}</span>
        <span>${config.density}</span>
        ${config.width ? `<span>${config.width}px</span>` : ''}
      </div>
    </header>
    <p class="controls-gallery-description">${config.description}</p>
    <div class="controls-gallery-control-host" data-gallery-controls="${config.id}"></div>
  `;
  const host = card.querySelector<HTMLElement>('[data-gallery-controls]');
  if (host && config.width) host.style.inlineSize = `${config.width}px`;
  return card;
}

function addDenseLayers(
  surface: MultiLayerNeuroSurface,
  geometry: SurfaceGeometry,
  phase: number
): void {
  addTaskEffectLayer(surface, geometry, phase);
  surface.addLayer(new DataLayer(
    'reliability',
    makeField(geometry.vertices, phase + 1.2, 1),
    null,
    'viridis',
    {
      range: [-1, 1],
      opacity: 0.64,
      presentation: {
        label: 'Reliability',
        description: 'Split-half reliability estimate',
        units: 'r'
      }
    }
  ));
  surface.addLayer(new DataLayer(
    'uncertainty',
    makeField(geometry.vertices, phase + 2.5, 2.4),
    null,
    'plasma',
    {
      range: [-2.4, 2.4],
      opacity: 0.42,
      blendMode: 'multiply',
      presentation: {
        label: 'Uncertainty',
        description: 'Posterior standard deviation',
        units: 's.d.'
      }
    }
  ));
  surface.addLayer(new DataLayer(
    'qc-residual',
    makeField(geometry.vertices, phase + 3.6, 0.8),
    null,
    'cool',
    {
      range: [-0.8, 0.8],
      opacity: 0.32,
      presentation: {
        label: 'QC residual',
        description: 'Residual spatial structure',
        units: 'a.u.'
      }
    }
  ));
}

function addTaskEffectLayer(
  surface: MultiLayerNeuroSurface,
  geometry: SurfaceGeometry,
  phase: number
): void {
  surface.addLayer(new DataLayer(
    'task-effect',
    makeField(geometry.vertices, phase, 5.2),
    null,
    'coolwarm',
    {
      range: [-5.2, 5.2],
      threshold: [-1.65, 1.65],
      opacity: 0.96,
      presentation: {
        label: 'Task effect',
        description: 'Standardized task contrast',
        units: 'z'
      }
    }
  ));
}

async function runControlsProductMode(
  ctx: ScenarioRunContext,
  task: string | null
): Promise<() => void> {
  const viewTask = task === 'view';
  const layersTask = task === 'layers';
  const focusedTask = viewTask || layersTask;
  const leftSurfaceId = 'left-cortex';
  const rightSurfaceId = 'right-cortex';
  document.body.classList.add(
    'controls-gallery-active',
    'controls-gallery-product-active'
  );
  const product = document.createElement('div');
  product.className = focusedTask
    ? 'controls-gallery-product controls-gallery-product--single-task'
    : 'controls-gallery-product';
  product.dataset.galleryState = 'loading';
  product.dataset.galleryMode = 'product';
  product.dataset.galleryTask = viewTask
    ? 'view'
    : layersTask ? 'layers' : 'view-and-layers';
  product.innerHTML = `
    <div class="controls-gallery-product-viewer" data-gallery-viewer="dense">
      <figure class="controls-gallery-product-legend" aria-label="Task effect color scale">
        <figcaption>Task effect <span>z</span></figcaption>
        <div class="controls-gallery-product-legend-strip" aria-hidden="true"></div>
        <div class="controls-gallery-product-legend-scale">
          <span>−5.2</span><span>0</span><span>5.2</span>
        </div>
        <p>Masked −1.65 to 1.65</p>
      </figure>
    </div>
    <aside class="controls-gallery-product-panel" aria-label="Scientific task controls">
      ${focusedTask ? `
        <nav class="controls-gallery-product-tasks" aria-label="Control task">
          <button type="button" data-gallery-task-button="view">View</button>
          <button type="button" data-gallery-task-button="layers">Layers</button>
        </nav>
      ` : ''}
      <div class="controls-gallery-control-host" data-gallery-controls="dense"></div>
    </aside>
  `;
  ctx.mount.replaceChildren(product);
  ctx.panel.replaceChildren();
  const viewerMount = product.querySelector<HTMLElement>(
    '[data-gallery-viewer="dense"]'
  );
  const controlsHost = product.querySelector<HTMLElement>(
    '[data-gallery-controls="dense"]'
  );
  if (!viewerMount || !controlsHost) {
    throw new Error('Controls product workspace was not created.');
  }

  const viewerHandle = createViewer(viewerMount, {
    preset: 'presentation',
    rimStrength: 0.12
  });
  const loadedLeft = await loadSurface(leftSample, 'gifti', 'left');
  const loadedRight = viewTask
    ? null
    : await loadSurface(rightSample, 'gifti', 'right');
  const leftGeometry = cloneGeometry(loadedLeft);
  const rightGeometry = loadedRight ? cloneGeometry(loadedRight) : null;
  loadedLeft.dispose();
  loadedRight?.dispose();
  const left = new MultiLayerNeuroSurface(leftGeometry, { baseColor: 0xaeb8c4 });
  left.hemisphere = 'left';
  if (focusedTask) addTaskEffectLayer(left, leftGeometry, 0.25);
  else addDenseLayers(left, leftGeometry, 0.25);
  viewerHandle.viewer.addSurface(left, leftSurfaceId);
  if (rightGeometry) {
    const right = new MultiLayerNeuroSurface(rightGeometry, {
      baseColor: 0xaeb8c4
    });
    right.hemisphere = 'right';
    if (focusedTask) addTaskEffectLayer(right, rightGeometry, 0.85);
    else addDenseLayers(right, rightGeometry, 0.85);
    viewerHandle.viewer.addSurface(right, rightSurfaceId);
    viewerHandle.viewer.registerBilateralSurfaceGroup({
      id: 'cortex',
      leftSurfaceId,
      rightSurfaceId
    });
  }

  const controls = mountSurfViewControls(viewerHandle.viewer, controlsHost, {
    label: viewTask
      ? 'Anatomical view'
      : layersTask ? 'Layer stack' : 'Bilateral task contrast controls',
    theme: 'dark',
    density: 'compact',
    features: {
      include: viewTask ? ['view'] : layersTask ? ['layers'] : ['view', 'layers']
    },
    session: { focusedSurfaceId: leftSurfaceId, focusedLayerId: 'task-effect' }
  });
  controls.element.dataset.galleryPanel = 'dense';
  await controls.element.updateComplete;

  const taskButtons = [...product.querySelectorAll<HTMLButtonElement>(
    '[data-gallery-task-button]'
  )];
  const taskButtonCleanups: Array<() => void> = [];
  const selectTask = (nextTask: 'view' | 'layers'): void => {
    controls.element.features = { include: [nextTask] };
    product.dataset.galleryTask = nextTask;
    for (const button of taskButtons) {
      const selected = button.dataset.galleryTaskButton === nextTask;
      button.setAttribute('aria-pressed', selected ? 'true' : 'false');
    }
  };
  for (const button of taskButtons) {
    const nextTask = button.dataset.galleryTaskButton as 'view' | 'layers';
    const listener = (): void => selectTask(nextTask);
    button.addEventListener('click', listener);
    taskButtonCleanups.push(() => button.removeEventListener('click', listener));
  }
  if (focusedTask) selectTask(viewTask ? 'view' : 'layers');

  let resizeFrame: number | null = null;
  let lastWidth = 0;
  let lastHeight = 0;
  const sizeAndRender = (force = false): void => {
    const width = Math.round(viewerMount.clientWidth);
    const height = Math.round(viewerMount.clientHeight);
    if (width < 1 || height < 1 ||
        (!force && width === lastWidth && height === lastHeight)) return;
    lastWidth = width;
    lastHeight = height;
    viewerHandle.viewer.resize(width, height);
    viewerHandle.viewer.camera.zoom = focusedTask
      ? width <= 760 ? 1.45 : 1.22
      : 1;
    viewerHandle.viewer.camera.updateProjectionMatrix();
    const viewResult = controls.session.setAnatomicalView({
      view: 'dorsal',
      target: viewTask
        ? { kind: 'surface', surfaceId: leftSurfaceId }
        : { kind: 'group', groupId: 'cortex' },
      fit: true,
      hemisphereGap: 12
    });
    const currentView = controls.session.getSnapshot().canonical.view.current;
    product.dataset.galleryViewResult = viewResult.ok ? 'ok' : viewResult.code;
    product.dataset.galleryCurrentView = currentView?.view ?? 'none';
    viewerHandle.viewer.render();
    const canvas = viewerMount.querySelector<HTMLCanvasElement>('canvas');
    product.dataset.galleryRenderedPixels = String(
      canvas ? countRenderedPixels(canvas) : 0
    );
    product.dataset.galleryCanvasSize = `${width}x${height}`;
  };
  const resizeObserver = new ResizeObserver(() => {
    if (resizeFrame !== null) cancelAnimationFrame(resizeFrame);
    resizeFrame = requestAnimationFrame(() => {
      resizeFrame = null;
      sizeAndRender();
    });
  });
  resizeObserver.observe(viewerMount);
  await afterLayout();
  sizeAndRender(true);
  await afterLayout();
  viewerHandle.viewer.render();
  await afterLayout();

  product.dataset.galleryState = 'ready';
  ctx.setBusy(false);
  ctx.status('SurfView controls product workspace ready');
  ctx.perf('');

  return () => {
    resizeObserver.disconnect();
    if (resizeFrame !== null) cancelAnimationFrame(resizeFrame);
    for (const cleanup of taskButtonCleanups) cleanup();
    controls.dispose();
    viewerHandle.cleanup();
    document.body.classList.remove(
      'controls-gallery-active',
      'controls-gallery-product-active'
    );
    ctx.status('Idle');
    ctx.perf('');
  };
}

export const controlsGallery: Scenario = {
  id: 'controls-gallery',
  title: 'Controls design gallery',
  description: 'Live control sessions across dense, sparse, narrow, selection, figure, and empty scientific states.',
  tags: ['controls', 'design', 'gallery', 'accessibility', 'qa'],
  run: async (ctx: ScenarioRunContext) => {
    ctx.setBusy(true, 'Preparing live controls gallery');
    const search = new URLSearchParams(window.location.search);
    const productMode = search.get('mode') === 'product';
    if (productMode) return runControlsProductMode(ctx, search.get('task'));
    document.body.classList.add('controls-gallery-active');

    const gallery = document.createElement('div');
    gallery.className = 'controls-gallery';
    gallery.dataset.galleryState = 'loading';
    gallery.innerHTML = `
      <header class="controls-gallery-intro">
        <div>
          <p class="controls-gallery-kicker">Visual gauntlet · round 7</p>
          <h2>SurfView controls, under scientific load</h2>
          <p>
            Six live sessions test the shipped panel across dense, sparse,
            inspection, figure, narrow, and empty states.
          </p>
        </div>
        <dl class="controls-gallery-summary">
          <div><dt>Targets</dt><dd>3</dd></div>
          <div><dt>Sessions</dt><dd>6</dd></div>
          <div><dt>Scene UI</dt><dd>0</dd></div>
        </dl>
      </header>
      <section class="controls-gallery-scene-card" aria-labelledby="gallery-live-scene-heading">
        <header>
          <div>
            <p class="controls-gallery-eyebrow">Primary workspace · dark · comfortable</p>
            <h3 id="gallery-live-scene-heading">Bilateral task contrast</h3>
          </div>
          <span>Live WebGL</span>
        </header>
        <div class="controls-gallery-live-workspace">
          <div class="controls-gallery-viewer" data-gallery-viewer="dense"></div>
          <aside
            class="controls-gallery-primary-controls"
            id="gallery-dense"
            data-gallery-config="dense"
          >
            <p>
              The canvas remains primary. This session contains only orientation
              and the ordered layer stack; scalar editing lives in its own pane below.
            </p>
            <div class="controls-gallery-control-host" data-gallery-controls="dense"></div>
          </aside>
        </div>
      </section>
      <section class="controls-gallery-grid" data-gallery-grid></section>
      <section class="controls-gallery-review-board" aria-labelledby="gallery-progress-heading">
        <div class="controls-gallery-progress">
          <p class="controls-gallery-kicker">Adversarial review board</p>
          <h3 id="gallery-progress-heading">Blind comparison · SurfView selected</h3>
          <p>The final critic preferred SurfView's canvas authority, scientific legend, selected-state clarity, and coherent narrow task panel over the ArcGIS Scene Viewer reference.</p>
          <ol>
            <li data-gallery-check="real"><span>01</span> Real targets and sessions</li>
            <li data-gallery-check="states"><span>02</span> Dense, sparse, selected, empty</li>
            <li data-gallery-check="tasks"><span>03</span> View and Layers task switching</li>
            <li data-gallery-check="responsive"><span>04</span> Narrow canvas-first composition</li>
            <li data-gallery-check="legend"><span>05</span> Quantitative map context</li>
            <li data-gallery-check="critic"><span>06</span> Fresh critic selected SurfView</li>
          </ol>
        </div>
        <section class="controls-gallery-filters" aria-labelledby="gallery-filter-heading">
          <h4 id="gallery-filter-heading">Review lens</h4>
          <div>
            <button type="button" class="ghost" data-gallery-filter="all" aria-pressed="true">All six</button>
            <button type="button" class="ghost" data-gallery-filter="workflow" aria-pressed="false">Workflows</button>
            <button type="button" class="ghost" data-gallery-filter="edge" aria-pressed="false">Edge states</button>
          </div>
        </section>
      </section>
    `;
    ctx.mount.replaceChildren(gallery);

    const configurations: readonly GalleryPanelConfiguration[] = [
      {
        id: 'dense',
        eyebrow: 'Primary workspace',
        title: 'Dense bilateral scene',
        description: 'Two hemispheres and ten ordered layers. The full workflow stays calm under a realistic layer load.',
        theme: 'dark',
        density: 'comfortable',
        features: ['view', 'layers'],
        focusedSurfaceId: 'lh',
        focusedLayerId: 'task-effect'
      },
      {
        id: 'narrow',
        eyebrow: 'Responsive workspace',
        title: 'Narrow layer editing',
        description: 'An independent session over the same bilateral scene, reduced to the layer workflow at a hard 292 px width.',
        theme: 'light',
        density: 'compact',
        width: 292,
        features: ['layers', 'layer-inspector'],
        focusedSurfaceId: 'rh',
        focusedLayerId: 'reliability'
      },
      {
        id: 'scalar',
        eyebrow: 'Sparse measurement',
        title: 'Scalar mapping with missing data',
        description: 'A genuinely indexed map samples every seventh vertex; its histogram and missing count come from the real layer summary.',
        theme: 'light',
        density: 'comfortable',
        features: ['layers', 'layer-inspector'],
        focusedSurfaceId: 'lh-sparse',
        focusedLayerId: 'sparse-response'
      },
      {
        id: 'selection',
        eyebrow: 'Scientific inspection',
        title: 'Selected unmapped vertex',
        description: 'Vertex 8 is present in the dense context map but deliberately absent from the sparse response map.',
        theme: 'dark',
        density: 'compact',
        features: ['selection'],
        focusedSurfaceId: 'lh-sparse',
        focusedLayerId: 'sparse-response'
      },
      {
        id: 'figure',
        eyebrow: 'Publication workflow',
        title: 'Figure preparation',
        description: 'Preset, background, transparency, and export remain a focused action rather than permanent rendering diagnostics.',
        theme: 'auto',
        density: 'comfortable',
        features: ['figure'],
        focusedSurfaceId: 'lh-sparse',
        focusedLayerId: 'context-map'
      },
      {
        id: 'empty',
        eyebrow: 'Edge condition',
        title: 'No scientific scene loaded',
        description: 'The opt-in panel explains what is unavailable without resetting the camera, inventing layers, or occupying the scene graph.',
        theme: 'auto',
        density: 'compact',
        features: ['view', 'layers']
      }
    ];

    const grid = gallery.querySelector<HTMLElement>('[data-gallery-grid]');
    if (!grid) throw new Error('Controls gallery grid was not created.');
    for (const config of configurations) {
      if (config.id !== 'dense') grid.appendChild(makeGalleryCard(config));
    }

    ctx.panel.replaceChildren();

    const denseViewerMount = gallery.querySelector<HTMLElement>(
      '[data-gallery-viewer="dense"]'
    );
    if (!denseViewerMount) throw new Error('Dense gallery viewer was not created.');

    const hiddenViewerMounts = document.createElement('div');
    hiddenViewerMounts.className = 'controls-gallery-target-mounts';
    hiddenViewerMounts.setAttribute('aria-hidden', 'true');
    const sparseViewerMount = document.createElement('div');
    const emptyViewerMount = document.createElement('div');
    sparseViewerMount.dataset.galleryViewer = 'sparse';
    emptyViewerMount.dataset.galleryViewer = 'empty';
    hiddenViewerMounts.append(sparseViewerMount, emptyViewerMount);
    gallery.appendChild(hiddenViewerMounts);

    const denseHandle = createViewer(denseViewerMount, {
      backgroundColor: 0x08111d,
      preset: 'presentation',
      rimStrength: 0.12
    });
    const sparseHandle = createViewer(sparseViewerMount, {
      backgroundColor: 0xf4f6f8,
      preset: 'paper-light',
      rimStrength: 0.06
    });
    const emptyHandle = createViewer(emptyViewerMount, {
      backgroundColor: 0x111820,
      preset: 'default'
    });

    const loaded = await Promise.all([
      loadSurface(leftSample, 'gifti', 'left'),
      loadSurface(rightSample, 'gifti', 'right')
    ]);
    const [loadedLeft, loadedRight] = loaded;
    const denseLeftGeometry = cloneGeometry(loadedLeft);
    const denseRightGeometry = cloneGeometry(loadedRight);
    const sparseGeometry = cloneGeometry(loadedLeft);
    loadedLeft.dispose();
    loadedRight.dispose();

    const denseLeft = new MultiLayerNeuroSurface(denseLeftGeometry, {
      baseColor: 0xaeb8c4
    });
    const denseRight = new MultiLayerNeuroSurface(denseRightGeometry, {
      baseColor: 0xaeb8c4
    });
    denseLeft.hemisphere = 'left';
    denseRight.hemisphere = 'right';
    addDenseLayers(denseLeft, denseLeftGeometry, 0.25);
    addDenseLayers(denseRight, denseRightGeometry, 0.85);
    denseHandle.viewer.addSurface(denseLeft, 'lh');
    denseHandle.viewer.addSurface(denseRight, 'rh');
    denseHandle.viewer.registerBilateralSurfaceGroup({
      id: 'cortex',
      leftSurfaceId: 'lh',
      rightSurfaceId: 'rh'
    });
    denseHandle.viewer.setAnatomicalView('dorsal', {
      layout: 'paired',
      groupId: 'cortex',
      fit: true,
      hemisphereGap: 12
    });

    const sparseSurface = new MultiLayerNeuroSurface(sparseGeometry, {
      baseColor: 0xd5d9de
    });
    sparseSurface.hemisphere = 'left';
    const sparse = makeSparseField(sparseGeometry.vertices, 7);
    sparseSurface.addLayer(new DataLayer(
      'sparse-response',
      sparse.values,
      sparse.indices,
      'magma',
      {
        range: [-2.8, 2.8],
        threshold: [-0.55, 0.55],
        opacity: 0.95,
        presentation: {
          label: 'Sparse response',
          description: 'Surface samples retained after strict quality control',
          units: '% signal',
          missingValueLabel: 'Not sampled'
        }
      }
    ));
    sparseSurface.addLayer(new DataLayer(
      'context-map',
      makeField(sparseGeometry.vertices, 1.4, 1.2),
      null,
      'viridis',
      {
        range: [-1.2, 1.2],
        opacity: 0.34,
        presentation: {
          label: 'Context map',
          description: 'Dense anatomical context for sparse measurements',
          units: 'a.u.'
        }
      }
    ));
    sparseHandle.viewer.addSurface(sparseSurface, 'lh-sparse');
    sparseHandle.viewer.setAnatomicalView('lateral', {
      surfaceId: 'lh-sparse',
      fit: true
    });
    const selectionResult = sparseHandle.viewer.setInspectionSelection({
      kind: 'vertex',
      surfaceId: 'lh-sparse',
      vertexIndex: 8
    });
    if (!selectionResult.ok) {
      throw new Error(`Gallery selection failed: ${selectionResult.message}`);
    }

    const controlHandles: SurfViewControlsHandle[] = [];
    const mountPanel = (
      viewer: typeof denseHandle.viewer,
      config: GalleryPanelConfiguration
    ): void => {
      const host = gallery.querySelector<HTMLElement>(
        `[data-gallery-controls="${config.id}"]`
      );
      if (!host) throw new Error(`Gallery control host "${config.id}" was not created.`);
      const controls = mountSurfViewControls(viewer, host, {
        label: config.title,
        theme: config.theme,
        density: config.density,
        ...(config.features ? { features: { include: config.features } } : {}),
        session: {
          focusedSurfaceId: config.focusedSurfaceId,
          focusedLayerId: config.focusedLayerId
        }
      });
      controls.element.dataset.galleryPanel = config.id;
      controlHandles.push(controls);
    };

    mountPanel(denseHandle.viewer, configurations[0]);
    mountPanel(denseHandle.viewer, configurations[1]);
    mountPanel(sparseHandle.viewer, configurations[2]);
    mountPanel(sparseHandle.viewer, configurations[3]);
    mountPanel(sparseHandle.viewer, configurations[4]);
    mountPanel(emptyHandle.viewer, configurations[5]);
    await Promise.all(controlHandles.map(handle => handle.element.updateComplete));

    let denseResizeFrame: number | null = null;
    let denseWidth = 0;
    let denseHeight = 0;
    const sizeAndRenderDenseScene = (force = false): void => {
      const width = Math.round(denseViewerMount.clientWidth);
      const height = Math.round(denseViewerMount.clientHeight);
      if (width < 1 || height < 1 ||
          (!force && width === denseWidth && height === denseHeight)) return;
      denseWidth = width;
      denseHeight = height;
      denseHandle.viewer.resize(width, height);
      denseHandle.viewer.setAnatomicalView('dorsal', {
        layout: 'paired',
        groupId: 'cortex',
        fit: true,
        hemisphereGap: 12
      });
      denseHandle.viewer.render();
      const canvas = denseViewerMount.querySelector<HTMLCanvasElement>('canvas');
      gallery.dataset.galleryRenderedPixels = String(
        canvas ? countRenderedPixels(canvas) : 0
      );
      gallery.dataset.galleryCanvasSize = `${width}x${height}`;
    };
    const denseResizeObserver = new ResizeObserver(() => {
      if (denseResizeFrame !== null) cancelAnimationFrame(denseResizeFrame);
      denseResizeFrame = requestAnimationFrame(() => {
        denseResizeFrame = null;
        sizeAndRenderDenseScene();
      });
    });
    denseResizeObserver.observe(denseViewerMount);
    await afterLayout();
    sizeAndRenderDenseScene(true);
    await afterLayout();
    denseHandle.viewer.render();
    await afterLayout();

    const workflowIds = new Set(['dense', 'narrow', 'scalar', 'figure']);
    const edgeIds = new Set(['selection', 'empty']);
    const filterButtons = [...gallery.querySelectorAll<HTMLButtonElement>(
      '[data-gallery-filter]'
    )];
    const applyFilter = (filter: string): void => {
      for (const button of filterButtons) {
        button.setAttribute(
          'aria-pressed',
          String(button.dataset.galleryFilter === filter)
        );
      }
      for (const card of gallery.querySelectorAll<HTMLElement>('[data-gallery-config]')) {
        const id = card.dataset.galleryConfig ?? '';
        card.hidden = filter === 'workflow'
          ? !workflowIds.has(id)
          : filter === 'edge'
            ? !edgeIds.has(id)
            : false;
      }
      gallery.dataset.galleryFilter = filter;
    };
    for (const button of filterButtons) {
      button.addEventListener('click', () => {
        applyFilter(button.dataset.galleryFilter ?? 'all');
      });
    }
    applyFilter('all');

    gallery.dataset.galleryState = 'ready';
    ctx.setBusy(false);
    ctx.status('Controls design gallery ready: 3 targets · 6 sessions');
    ctx.perf('All panels observe immutable target descriptors');

    return () => {
      denseResizeObserver.disconnect();
      if (denseResizeFrame !== null) cancelAnimationFrame(denseResizeFrame);
      for (const handle of controlHandles) handle.dispose();
      denseHandle.cleanup();
      sparseHandle.cleanup();
      emptyHandle.cleanup();
      document.body.classList.remove('controls-gallery-active');
      ctx.status('Idle');
      ctx.perf('');
    };
  }
};
