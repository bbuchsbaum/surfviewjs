import { expect, test } from '@playwright/test';

test.describe('controls design gallery', () => {
  test('offers a product mode with one canvas-dominant task panel and no QA chrome', async ({ page }) => {
    test.setTimeout(60_000);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto('/demo/index.html?scenario=controls-gallery&mode=product');

    const product = page.locator('[data-gallery-mode="product"]');
    await expect(product).toHaveAttribute('data-gallery-state', 'ready', {
      timeout: 20_000
    });
    await expect(product.locator('surfview-controls')).toHaveCount(1);
    await expect(page.locator('.controls-gallery-intro')).toHaveCount(0);
    await expect(page.locator('.controls-gallery-review-board')).toHaveCount(0);
    await expect(page.locator('.controls-gallery-scene-card')).toHaveCount(0);
    await expect(page.getByText(/visual gauntlet/i)).toHaveCount(0);
    await expect(page.getByText(/adversarial review/i)).toHaveCount(0);
    await expect(page.locator('.nav')).toBeHidden();
    await expect(page.locator('.topbar')).toBeHidden();
    await expect(page.locator('#status-block')).toBeHidden();

    expect(Number(await product.getAttribute('data-gallery-rendered-pixels')))
      .toBeGreaterThan(10_000);
    const composition = await product.evaluate(element => {
      const canvas = element.querySelector('[data-gallery-viewer="dense"]');
      const panel = element.querySelector('.controls-gallery-product-panel');
      const canvasRect = canvas?.getBoundingClientRect();
      const panelRect = panel?.getBoundingClientRect();
      return {
        canvasWidth: canvasRect?.width ?? 0,
        canvasHeight: canvasRect?.height ?? 0,
        panelWidth: panelRect?.width ?? 0,
        panelHeight: panelRect?.height ?? 0,
        panelOverflow: panel ? getComputedStyle(panel).overflowY : ''
      };
    });
    expect(composition.canvasWidth).toBeGreaterThan(1_000);
    expect(composition.canvasHeight).toBeGreaterThan(900);
    expect(composition.panelWidth).toBeLessThanOrEqual(380);
    expect(composition.panelHeight).toBe(1_000);
    expect(composition.panelOverflow).toBe('auto');
    await expect(product).toHaveAttribute('data-gallery-view-result', 'ok');
    await expect(product).toHaveAttribute('data-gallery-current-view', 'dorsal');
    await expect(product.getByRole('radio', { name: 'Dorsal' })).toBeChecked();
    await expect(product.getByText('Applies to Cortex Pair')).toBeVisible();
    await expect(product.locator('[data-layer-id]')).toHaveCount(10);
  });

  test('composes one view task over a full narrow scientific scene', async ({ page }) => {
    test.setTimeout(60_000);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(
      '/demo/index.html?scenario=controls-gallery&mode=product&task=view'
    );

    const product = page.locator('[data-gallery-mode="product"]');
    await expect(product).toHaveAttribute('data-gallery-state', 'ready', {
      timeout: 20_000
    });
    await expect(product).toHaveAttribute('data-gallery-task', 'view');
    await expect(product.locator('surfview-controls')).toHaveCount(1);
    await expect(product.locator('[data-layer-id]')).toHaveCount(0);
    await expect(product).toHaveAttribute('data-gallery-view-result', 'ok');
    await expect(product).toHaveAttribute('data-gallery-current-view', 'dorsal');
    await expect(product.getByRole('radio', { name: 'Dorsal' })).toBeChecked();
    await expect(product.getByText('Applies to Left Cortex')).toBeVisible();
    await expect(product.getByLabel('Task effect color scale')).toBeVisible();
    expect(Number(await product.getAttribute('data-gallery-rendered-pixels')))
      .toBeGreaterThan(10_000);

    const composition = await product.evaluate(element => {
      const viewer = element.querySelector('[data-gallery-viewer="dense"]');
      const canvas = viewer?.querySelector('canvas');
      const panel = element.querySelector('.controls-gallery-product-panel');
      const productRect = element.getBoundingClientRect();
      const viewerRect = viewer?.getBoundingClientRect();
      const canvasRect = canvas?.getBoundingClientRect();
      const panelRect = panel?.getBoundingClientRect();
      return {
        productWidth: productRect.width,
        productHeight: productRect.height,
        productScrollWidth: element.scrollWidth,
        viewerWidth: viewerRect?.width ?? 0,
        viewerHeight: viewerRect?.height ?? 0,
        canvasWidth: canvasRect?.width ?? 0,
        canvasHeight: canvasRect?.height ?? 0,
        panelWidth: panelRect?.width ?? 0,
        panelHeight: panelRect?.height ?? 0,
        viewerBottom: viewerRect?.bottom ?? 0,
        panelTop: panelRect?.top ?? 0,
        panelBottom: panelRect?.bottom ?? 0,
        productBottom: productRect.bottom
      };
    });
    expect(composition.productWidth).toBe(390);
    expect(composition.productHeight).toBe(844);
    expect(composition.productScrollWidth).toBeLessThanOrEqual(390);
    expect(composition.viewerWidth).toBe(390);
    expect(composition.viewerHeight).toBeGreaterThan(500);
    expect(composition.canvasWidth).toBeCloseTo(composition.viewerWidth, 0);
    expect(composition.canvasHeight).toBeCloseTo(composition.viewerHeight, 0);
    expect(composition.panelWidth).toBeLessThan(390);
    expect(composition.panelHeight).toBeLessThanOrEqual(300);
    expect(composition.viewerBottom).toBeLessThanOrEqual(composition.panelTop);
    expect(composition.panelBottom).toBeLessThanOrEqual(composition.productBottom);
    expect(await page.evaluate(() => document.documentElement.scrollWidth))
      .toBeLessThanOrEqual(390);

    const viewTask = product.getByRole('button', { name: 'View', exact: true });
    const layersTask = product.getByRole('button', { name: 'Layers', exact: true });
    await expect(viewTask).toHaveAttribute('aria-pressed', 'true');
    await expect(layersTask).toHaveAttribute('aria-pressed', 'false');
    await layersTask.click();
    await expect(product).toHaveAttribute('data-gallery-task', 'layers');
    await expect(product.locator('[data-layer-id]')).toHaveCount(2);
    await viewTask.click();
    await expect(product).toHaveAttribute('data-gallery-task', 'view');
    await expect(product.locator('[data-layer-id]')).toHaveCount(0);
  });

  test('exposes the bilateral layer stack as one focused desktop task', async ({ page }) => {
    test.setTimeout(60_000);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(
      '/demo/index.html?scenario=controls-gallery&mode=product&task=layers'
    );

    const product = page.locator('[data-gallery-mode="product"]');
    await expect(product).toHaveAttribute('data-gallery-state', 'ready', {
      timeout: 20_000
    });
    await expect(product).toHaveAttribute('data-gallery-task', 'layers');
    await expect(product.locator('surfview-controls')).toHaveCount(1);
    await expect(product.getByRole('button', { name: 'Layers', exact: true }))
      .toHaveAttribute('aria-pressed', 'true');
    await expect(product.getByRole('radio')).toHaveCount(0);
    await expect(product.locator('[data-layer-id]')).toHaveCount(4);
    await expect(product.getByText('Left Cortex', { exact: true })).toBeVisible();
    await expect(product.getByText('Right Cortex', { exact: true })).toBeVisible();
    await expect(product.getByLabel('Task effect color scale')).toBeVisible();
  });

  test('renders six real immutable control sessions across gallery states', async ({ page }) => {
    test.setTimeout(60_000);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto('/demo/index.html?scenario=controls-gallery');

    const gallery = page.locator('[data-gallery-state]');
    await expect(gallery).toHaveAttribute('data-gallery-state', 'ready', {
      timeout: 20_000
    });
    await expect(gallery.getByText('Visual gauntlet · round 7')).toBeVisible();
    await expect(gallery.getByText('Blind comparison · SurfView selected'))
      .toBeVisible();
    const panels = gallery.locator('surfview-controls');
    await expect(panels).toHaveCount(6);

    const renderedPixels = Number(await gallery.getAttribute(
      'data-gallery-rendered-pixels'
    ));
    expect(renderedPixels).toBeGreaterThan(5_000);
    const canvasGeometry = await gallery.locator('[data-gallery-viewer="dense"]')
      .evaluate(viewerMount => {
        const canvas = viewerMount.querySelector('canvas');
        const mountRect = viewerMount.getBoundingClientRect();
        const canvasRect = canvas?.getBoundingClientRect();
        return {
          mountWidth: mountRect.width,
          mountHeight: mountRect.height,
          canvasWidth: canvasRect?.width ?? 0,
          canvasHeight: canvasRect?.height ?? 0
        };
      });
    expect(canvasGeometry.mountWidth).toBeGreaterThan(650);
    expect(canvasGeometry.mountHeight).toBeGreaterThan(500);
    expect(canvasGeometry.canvasWidth).toBeCloseTo(canvasGeometry.mountWidth, 0);
    expect(canvasGeometry.canvasHeight).toBeCloseTo(canvasGeometry.mountHeight, 0);

    const snapshots = await panels.evaluateAll(elements => elements.map(element => {
      const controls = element as HTMLElement & {
        snapshot: {
          canonical: {
            surfaces: readonly { layers: readonly unknown[] }[];
            selection: { current: { kind: string; vertexIndex?: number } };
          };
        };
      };
      return {
        id: controls.dataset.galleryPanel,
        immutable: Object.isFrozen(controls.snapshot) &&
          Object.isFrozen(controls.snapshot.canonical) &&
          Object.isFrozen(controls.snapshot.canonical.surfaces),
        layerCount: controls.snapshot.canonical.surfaces.reduce(
          (count, surface) => count + surface.layers.length,
          0
        ),
        selection: controls.snapshot.canonical.selection.current
      };
    }));
    expect(snapshots).toEqual([
      expect.objectContaining({ id: 'dense', immutable: true, layerCount: 10 }),
      expect.objectContaining({ id: 'narrow', immutable: true, layerCount: 10 }),
      expect.objectContaining({ id: 'scalar', immutable: true, layerCount: 3 }),
      expect.objectContaining({
        id: 'selection',
        immutable: true,
        layerCount: 3,
        selection: expect.objectContaining({ kind: 'vertex', vertexIndex: 8 })
      }),
      expect.objectContaining({ id: 'figure', immutable: true, layerCount: 3 }),
      expect.objectContaining({ id: 'empty', immutable: true, layerCount: 0 })
    ]);

    const narrow = gallery.locator('[data-gallery-panel="narrow"]');
    expect(await page.evaluate(() => {
      const dense = document.querySelector('[data-gallery-panel="dense"]') as
        (HTMLElement & { snapshot: { canonical: unknown } }) | null;
      const narrowPanel = document.querySelector('[data-gallery-panel="narrow"]') as
        (HTMLElement & { snapshot: { canonical: unknown } }) | null;
      return dense?.snapshot.canonical === narrowPanel?.snapshot.canonical;
    })).toBe(true);
    await expect(page.locator('[data-gallery-panel="dense"]')).toHaveAttribute('theme', 'dark');
    await expect(narrow).toHaveAttribute('theme', 'light');
    await expect(narrow).toHaveAttribute('density', 'compact');
    await expect(narrow).toHaveCSS('width', '292px');

    const scalar = page.locator('[data-gallery-panel="scalar"]');
    await expect(scalar.getByText(/finite values/i)).toBeVisible();
    await expect(scalar.getByText(/missing/i)).toBeVisible();
    await expect(scalar.locator('.histogram')).toBeVisible();

    const selection = page.locator('[data-gallery-panel="selection"]');
    await expect(selection.getByText('Vertex', { exact: true })).toBeVisible();
    await expect(selection.locator('[data-layer-value="sparse-response"]'))
      .toContainText('Missing');
    await expect(selection.locator('[data-layer-value="context-map"]'))
      .not.toContainText('Missing');

    const figure = page.locator('[data-gallery-panel="figure"]');
    await expect(figure).toHaveAttribute('theme', 'auto');
    await figure.getByRole('button', { name: 'Export…' }).click();
    await expect(figure.getByRole('dialog', { name: 'Export PNG' })).toBeVisible();
    await page.keyboard.press('Escape');

    const workflowFilter = page.getByRole('button', { name: 'Workflows' });
    await workflowFilter.click();
    await expect(workflowFilter).toHaveAttribute('aria-pressed', 'true');
    await expect(gallery.locator('[data-gallery-config]:visible')).toHaveCount(4);
    const edgeFilter = page.getByRole('button', { name: 'Edge states' });
    await edgeFilter.click();
    await expect(gallery.locator('[data-gallery-config]:visible')).toHaveCount(2);
    await expect(gallery.locator('[data-gallery-config="selection"]')).toBeVisible();
    await expect(gallery.locator('[data-gallery-config="empty"]')).toBeVisible();
  });
});
