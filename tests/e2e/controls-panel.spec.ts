import { expect, test } from '@playwright/test';

test.describe('first-party controls visual fixture', () => {
  test('keeps View and Layers usable at desktop and narrow inline widths', async ({ page }) => {
    test.setTimeout(60_000);
    const blockedExternalRequests: string[] = [];
    await page.route('**/*', async route => {
      const url = new URL(route.request().url());
      const localHttp = url.protocol === 'http:' &&
        (url.hostname === 'localhost' || url.hostname === '127.0.0.1');
      if (localHttp || url.protocol === 'data:' || url.protocol === 'blob:') {
        await route.continue();
        return;
      }
      blockedExternalRequests.push(url.href);
      await route.abort('blockedbyclient');
    });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/demo/index.html');
    await page.getByRole('button', { name: /first-party controls panel/i }).click();

    const controls = page.locator('[data-visual-qa="controls-panel"]');
    await expect(controls).toBeVisible({ timeout: 15000 });
    await page.locator('.topbar').evaluate(element => {
      (element as HTMLElement).style.setProperty('display', 'none', 'important');
    });
    await expect(controls.getByRole('radio')).toHaveCount(6);
    await expect(controls.locator('[data-layer-id]')).toHaveCount(8);
    await expect(controls.getByText('Bottom → top')).toBeVisible();
    await expect(controls.getByText('Pinned bottom').first()).toBeVisible();
    await expect(controls).toHaveAttribute('theme', 'dark');
    await expect(controls).toHaveAttribute('density', 'comfortable');
    expect(await page.evaluate(async () => {
      try {
        await fetch('https://network.invalid/surfview-controls-certification');
        return false;
      } catch {
        return true;
      }
    })).toBe(true);
    expect(blockedExternalRequests).toEqual([
      'https://network.invalid/surfview-controls-certification'
    ]);

    const assertContained = async () => {
      const overflows = await controls.evaluate(element => {
        const root = element.shadowRoot;
        if (!root) return ['missing shadow root'];
        const host = element.getBoundingClientRect();
        return [...root.querySelectorAll<HTMLElement>(
          'button, input, select, [data-layer-id]'
        )].flatMap(candidate => {
          if (candidate.getClientRects().length === 0) return [];
          const rect = candidate.getBoundingClientRect();
          return rect.left < host.left - 1 || rect.right > host.right + 1
            ? [candidate.getAttribute('aria-label') ?? candidate.tagName]
            : [];
        });
      });
      expect(overflows).toEqual([]);
    };

    const desktop = await controls.screenshot();
    expect(desktop.length).toBeGreaterThan(10000);
    await expect(controls).toHaveScreenshot(
      'controls-desktop-many-dark-comfortable.png',
      { animations: 'disabled', caret: 'hide', maxDiffPixelRatio: 0.005 }
    );
    await assertContained();

    const inheritedFonts = await controls.evaluate(element => {
      const panel = element.shadowRoot?.querySelector<HTMLElement>('.panel');
      return {
        host: getComputedStyle(element).fontFamily,
        panel: panel ? getComputedStyle(panel).fontFamily : null
      };
    });
    expect(inheritedFonts.host).toContain('Georgia');
    expect(inheritedFonts.panel).toBe(inheritedFonts.host);

    const figure = controls.locator('.figure-section');
    const figurePreset = figure.getByRole('combobox', { name: 'Figure style preset' });
    await figurePreset.selectOption('paper-light');
    await expect(figure.locator('.figure-defaults')).toContainText('Paper Light');
    await expect(figure.locator('.figure-defaults')).toContainText('2400 × 1800 px');
    await expect(figure.locator('.figure-defaults')).toContainText('300 dpi');
    const paperState = await controls.evaluate(element => (
      element as HTMLElement & {
        session: { getSnapshot(): { canonical: { figure: unknown } } };
      }
    ).session.getSnapshot().canonical.figure);
    expect(paperState).toMatchObject({
      preset: { id: 'paper-light' },
      defaultWidth: 2400,
      defaultHeight: 1800,
      defaultDpi: 300,
      defaultTransparent: true,
      defaultColorbar: true
    });

    const background = figure.getByLabel('Figure background color');
    await background.evaluate((input: HTMLInputElement) => {
      input.value = '#fef3c7';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await expect(figure.locator('.background-value')).toHaveText('#FEF3C7');
    const transparency = figure.getByRole('checkbox', {
      name: 'Transparent viewer background'
    });
    await expect(transparency).not.toBeChecked();
    await transparency.check();
    await expect(transparency).toBeChecked();
    expect(await controls.evaluate(element => (
      element as HTMLElement & {
        session: {
          getSnapshot(): {
            canonical: { figure: { background: number; transparent: boolean } };
          };
        };
      }
    ).session.getSnapshot().canonical.figure)).toMatchObject({
      background: 0xfef3c7,
      transparent: true
    });

    const dialog = controls.getByRole('dialog', { name: 'Export PNG' });
    const exportAction = figure.getByRole('button', { name: 'Export…' });
    await expect(dialog).toBeHidden();
    await exportAction.click();
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('spinbutton', { name: 'Width (px)' })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(exportAction).toBeFocused();

    await exportAction.click();
    const exportWidth = dialog.getByRole('spinbutton', { name: 'Width (px)' });
    const exportHeight = dialog.getByRole('spinbutton', { name: 'Height (px)' });
    const exportDpi = dialog.getByRole('spinbutton', { name: 'DPI' });
    await exportWidth.fill('4096');
    await exportHeight.fill('2160');
    await exportDpi.fill('300');
    await dialog.getByRole('textbox', { name: 'Filename' }).fill('cortex-figure.png');
    await dialog.getByRole('textbox', { name: 'Title', exact: true })
      .fill('Bilateral cortex');
    await expect(dialog.getByRole('checkbox', { name: 'Transparent background' }))
      .toBeChecked();
    await expect(dialog.getByRole('checkbox', { name: 'Include colorbar' })).toBeChecked();
    const highResolution = await dialog.screenshot();
    expect(highResolution.length).toBeGreaterThan(5000);

    // Exercise the real browser download at a modest size after proving that
    // the dialog accepts a deterministic high-resolution configuration.
    await exportWidth.fill('320');
    await exportHeight.fill('240');
    const downloadPromise = page.waitForEvent('download');
    await dialog.getByRole('button', { name: 'Export PNG', exact: true }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe('cortex-figure.png');
    await expect(dialog).toBeHidden();
    await expect(exportAction).toBeFocused();
    await expect(controls.locator('.message[role="status"]'))
      .toHaveText('Exported 320 × 240 PNG.');

    await controls.evaluate(element => {
      (element as HTMLElement & { theme: string }).theme = 'auto';
    });
    await page.emulateMedia({ colorScheme: 'light' });
    await expect(controls).toHaveAttribute('theme', 'auto');
    await expect(controls.locator('.panel')).toHaveCSS('background-color', 'rgb(255, 255, 255)');
    const automaticLight = await controls.screenshot();
    await expect(controls).toHaveScreenshot(
      'controls-auto-light-comfortable.png',
      { animations: 'disabled', caret: 'hide', maxDiffPixelRatio: 0.005 }
    );
    await page.emulateMedia({ colorScheme: 'dark' });
    await expect(controls.locator('.panel')).toHaveCSS('background-color', 'rgb(18, 24, 32)');
    const automaticDark = await controls.screenshot();
    await expect(controls).toHaveScreenshot(
      'controls-auto-dark-comfortable.png',
      { animations: 'disabled', caret: 'hide', maxDiffPixelRatio: 0.005 }
    );
    expect(automaticDark.equals(automaticLight)).toBe(false);

    await controls.evaluate(element => {
      const typed = element as HTMLElement & { theme: string; density: string };
      typed.theme = 'light';
      typed.density = 'comfortable';
      element.style.setProperty('--surfview-controls-focus', '#ff00ff');
    });
    await expect(controls).toHaveAttribute('theme', 'light');
    await expect(controls.locator('.panel')).toHaveCSS('background-color', 'rgb(255, 255, 255)');
    expect(await controls.evaluate(element =>
      getComputedStyle(element).getPropertyValue('--surfview-controls-focus').trim()
    )).toBe('#ff00ff');
    const comfortableHeight = await figure.evaluate(element =>
      element.getBoundingClientRect().height
    );
    const light = await controls.screenshot();
    await expect(controls).toHaveScreenshot(
      'controls-light-comfortable.png',
      { animations: 'disabled', caret: 'hide', maxDiffPixelRatio: 0.005 }
    );
    await controls.evaluate(element => {
      (element as HTMLElement & { density: string }).density = 'compact';
    });
    await expect(controls).toHaveAttribute('density', 'compact');
    const compactHeight = await figure.evaluate(element =>
      element.getBoundingClientRect().height
    );
    expect(compactHeight).toBeLessThan(comfortableHeight);
    const compact = await controls.screenshot();
    await expect(controls).toHaveScreenshot(
      'controls-light-compact.png',
      { animations: 'disabled', caret: 'hide', maxDiffPixelRatio: 0.005 }
    );
    expect(compact.equals(light)).toBe(false);
    await controls.evaluate(element => {
      const typed = element as HTMLElement & { theme: string; density: string };
      typed.theme = 'dark';
      typed.density = 'comfortable';
      element.style.removeProperty('--surfview-controls-focus');
    });
    await expect(controls).toHaveAttribute('theme', 'dark');
    await expect(controls).toHaveAttribute('density', 'comfortable');
    await expect(controls.locator('.panel')).toHaveCSS('background-color', 'rgb(18, 24, 32)');

    const selectedLayer = controls.locator('.selected-layer-section');
    await expect(selectedLayer.locator('.selected-layer-title')).toHaveText('Activation');
    await expect(selectedLayer.getByText('Mask values between', { exact: true }))
      .toBeVisible();
    await expect(selectedLayer.locator('.mask-band')).toHaveCount(1);

    const colormap = controls.getByRole('combobox', { name: 'Activation colormap' });
    await colormap.focus();
    await colormap.press('v');
    await colormap.press('i');
    await expect(colormap).toHaveValue('viridis');

    const displayLowNumber = controls.getByRole('spinbutton', {
      name: 'Activation display range lower'
    });
    await displayLowNumber.fill('-3.75');
    await displayLowNumber.press('Enter');
    await expect(displayLowNumber).toHaveValue('-3.75');

    const maskLowNumber = controls.getByRole('spinbutton', {
      name: 'Activation mask values between lower'
    });
    await maskLowNumber.fill('1.2');
    await maskLowNumber.press('Enter');
    await expect(selectedLayer.getByText(/masking off \(equal endpoints\)/i)).toBeVisible();
    await expect(selectedLayer.locator('.mask-band')).toHaveCount(0);

    const symmetricLock = controls.getByRole('checkbox', {
      name: /lock display range symmetrically around zero/i
    });
    await symmetricLock.focus();
    await symmetricLock.press('Space');
    await expect(symmetricLock).toBeChecked();
    const displayLowSlider = controls.getByRole('slider', {
      name: 'Activation display range lower slider'
    });
    await displayLowSlider.focus();
    await displayLowSlider.press('ArrowRight');
    const symmetricRange = await selectedLayer.locator(
      'input[type="number"][data-range-kind="display"]'
    ).evaluateAll(inputs => inputs.map(input => Number((input as HTMLInputElement).value)));
    expect(symmetricRange[0]).toBeCloseTo(-symmetricRange[1], 8);

    const selection = controls.locator('.selection-section');
    await expect(selection).toHaveAttribute('data-empty', 'true');
    const selectVertex = page.getByRole('button', { name: 'Fixture: select vertex' });
    await selectVertex.focus();
    await selectVertex.press('Enter');
    await expect(selection).toHaveAttribute('data-empty', 'false');
    await expect(selection.getByText('lh', { exact: true })).toBeVisible();
    await expect(selection.getByText('2', { exact: true }).first()).toBeVisible();
    await expect(selection.locator('[data-layer-value="activation"]'))
      .toHaveAttribute('aria-current', 'true');
    await expect(selection.locator('.selection-values-heading'))
      .toHaveText('Layer values at selected vertex 2');
    await expect(selection.locator('[data-layer-value="activation"] dd'))
      .toHaveText('2.6352741718292236 z');
    await expect(selection.locator('[aria-live="polite"]'))
      .toHaveText('Selected vertex 2 on surface lh.');

    const medial = controls.getByRole('radio', { name: 'Medial' });
    await medial.focus();
    await medial.press('Space');
    await expect(medial).toBeChecked();

    const fit = controls.getByRole('button', { name: 'Fit', exact: true });
    await fit.focus();
    await fit.press('Enter');
    const reset = controls.getByRole('button', { name: 'Reset', exact: true });
    await reset.focus();
    await reset.press('Space');
    await expect(medial).not.toBeChecked();

    const surfaceVisibility = controls.getByRole('checkbox', { name: 'Show Lh' });
    await surfaceVisibility.focus();
    await surfaceVisibility.press('Space');
    await expect(surfaceVisibility).not.toBeChecked();
    await surfaceVisibility.press('Space');
    await expect(surfaceVisibility).toBeChecked();

    const layerVisibility = controls.getByRole('checkbox', { name: 'Show Activation' }).first();
    await layerVisibility.focus();
    await layerVisibility.press('Space');
    await expect(layerVisibility).not.toBeChecked();
    await layerVisibility.press('Space');
    await expect(layerVisibility).toBeChecked();

    const focusVariance = controls.getByRole('button', {
      name: 'Focus Variance for editing'
    }).first();
    await focusVariance.focus();
    await focusVariance.press('Enter');
    await expect(focusVariance).toHaveAttribute('aria-pressed', 'true');
    await expect(selectedLayer.locator('.selected-layer-title')).toHaveText('Variance');
    await expect(selection.locator('[data-layer-value="activation"]'))
      .toHaveAttribute('aria-current', 'false');
    await expect(selection.locator('[data-layer-value="variance"]'))
      .toHaveAttribute('aria-current', 'true');
    await expect(selection.getByText('2', { exact: true }).first()).toBeVisible();

    const opacity = controls.getByRole('slider', { name: 'Variance opacity' });
    await page.getByRole('button', { name: 'Fixture: external opacity' }).click();
    await expect(opacity).toHaveValue('0.31');
    expect(await controls.evaluate(element => {
      const snapshot = (element as HTMLElement & {
        session: {
          getSnapshot(): {
            canonical: {
              surfaces: readonly {
                id: string;
                layers: readonly { id: string; opacity: number }[];
              }[];
            };
          };
        };
      }).session.getSnapshot();
      return snapshot.canonical.surfaces
        .find(surface => surface.id === 'lh')?.layers
        .find(layer => layer.id === 'variance')?.opacity;
    })).toBeCloseTo(0.31, 8);
    const previousOpacity = Number(await opacity.inputValue());
    await opacity.focus();
    await opacity.press('ArrowLeft');
    expect(Number(await opacity.inputValue())).toBeLessThan(previousOpacity);
    expect(await controls.evaluate(element => {
      const snapshot = (element as HTMLElement & {
        session: {
          getSnapshot(): {
            canonical: {
              surfaces: readonly {
                id: string;
                layers: readonly { id: string; opacity: number }[];
              }[];
            };
          };
        };
      }).session.getSnapshot();
      return snapshot.canonical.surfaces
        .find(surface => surface.id === 'lh')?.layers
        .find(layer => layer.id === 'variance')?.opacity;
    })).toBeLessThan(previousOpacity);
    expect(await page.evaluate(() => (
      window as typeof window & {
        __surfviewControlsFixture?: {
          getLayerOpacity(surfaceId: string, layerId: string): number | null;
        };
      }
    ).__surfviewControlsFixture?.getLayerOpacity('lh', 'variance')))
      .toBeLessThan(previousOpacity);

    const blend = controls.getByRole('combobox', { name: 'Variance blend mode' });
    await blend.focus();
    await blend.press('a');
    await expect(blend).toHaveValue('additive');

    const clearSelection = page.getByRole('button', { name: 'Fixture: clear selection' });
    await clearSelection.focus();
    await clearSelection.press('Space');
    await expect(selection).toHaveAttribute('data-empty', 'true');
    await expect(selection.getByText(/no vertex or parcel selected/i)).toBeVisible();
    await expect(selection.locator('[aria-live="polite"]')).toHaveText('Selection cleared.');

    const firstSurface = controls.locator('[data-surface-id="lh"]');
    const moveVariance = firstSurface.getByRole('button', { name: 'Move Variance up' });
    await moveVariance.focus();
    await moveVariance.press('Enter');
    await expect(firstSurface.locator('[data-layer-id]')).toHaveCount(4);
    expect(await firstSurface.locator('[data-layer-id]').evaluateAll(rows =>
      rows.map(row => (row as HTMLElement).dataset.layerId)
    )).toEqual(['base', 'variance', 'activation', 'quality']);

    await controls.evaluate(element => {
      (element as HTMLElement).style.width = '300px';
    });
    await expect(controls).toHaveCSS('width', '300px');
    await expect(controls.getByRole('button', { name: /focus activation for editing/i }).first())
      .toBeVisible();
    await expect(controls.getByRole('button', { name: /move variance up/i }).first())
      .toBeDisabled();
    await assertContained();
    const narrow = await controls.screenshot();
    expect(narrow.length).toBeGreaterThan(10000);
    expect(narrow.equals(desktop)).toBe(false);
    await expect(controls).toHaveScreenshot(
      'controls-narrow-many-dark-comfortable.png',
      { animations: 'disabled', caret: 'hide', maxDiffPixelRatio: 0.005 }
    );

    await page.getByRole('button', { name: 'Fixture: one layer' }).click();
    await expect(controls.locator('[data-layer-id]')).toHaveCount(1);
    await expect(controls.getByText(/1 surface · 1 layer/i)).toBeVisible();
    await assertContained();
    const oneLayer = await controls.screenshot();
    expect(oneLayer.length).toBeGreaterThan(3000);
    await expect(controls).toHaveScreenshot(
      'controls-narrow-one-layer.png',
      { animations: 'disabled', caret: 'hide', maxDiffPixelRatio: 0.005 }
    );

    await page.getByRole('button', { name: 'Fixture: empty' }).click();
    await expect(controls.locator('[data-layer-id]')).toHaveCount(0);
    await expect(controls.getByText(/no surfaces or layers are loaded/i)).toBeVisible();
    await assertContained();
    const empty = await controls.screenshot();
    expect(empty.length).toBeGreaterThan(2000);
    expect(empty.equals(oneLayer)).toBe(false);
    await expect(controls).toHaveScreenshot(
      'controls-narrow-empty.png',
      { animations: 'disabled', caret: 'hide', maxDiffPixelRatio: 0.005 }
    );
    expect(blockedExternalRequests).toEqual([
      'https://network.invalid/surfview-controls-certification'
    ]);
  });
});
