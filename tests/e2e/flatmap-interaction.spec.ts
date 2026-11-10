import { test, expect, type Page, type Locator } from '@playwright/test';

const paint = (page: Page) => page.evaluate(() => new Promise<void>(resolve =>
  requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));

async function pinPixels(page: Page, canvas: Locator) {
  const png = (await canvas.screenshot()).toString('base64');
  return page.evaluate(async encoded => {
    const blob = new Blob([Uint8Array.from(atob(encoded), c => c.charCodeAt(0))]);
    const bitmap = await createImageBitmap(blob);
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width; canvas.height = bitmap.height;
    const context = canvas.getContext('2d')!; context.drawImage(bitmap, 0, 0); bitmap.close();
    const rgba = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let count = 0, x = 0, y = 0;
    for (let i = 0; i < rgba.length; i += 4) {
      if (rgba[i]! > 190 && rgba[i + 1]! > 140 && rgba[i + 2]! < 85) {
        count++; x += (i / 4) % canvas.width; y += Math.floor(i / 4 / canvas.width);
      }
    }
    return { count, x: x / count, y: y / count };
  }, png);
}

test('flatmap and folded clicks keep a visible pin in both views, including hidden cortex', async ({ page }) => {
  test.setTimeout(90000);
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/demo/index.html?scenario=anatomy&mode=flatmap');
  const status = page.locator('[data-linked-flatmap-status]');
  await expect(status).toContainText('Ready:', { timeout: 60000 });
  const flat = page.locator('[data-visual-qa="linked-flatmap-canvas"]');
  const folded = page.locator('.anat-cell').first().locator('.film-viewer canvas');
  // Select actual chart coordinates on the near and far sides of the same anatomy.
  // No test API or private viewer state is installed in the demo.
  const points = await page.evaluate(async () => {
    // @ts-expect-error Browser-side source URL resolved by Vite.
    const { loadMatchedFlatMap } = await import('/demo/kit/flatmap-data.ts');
    const data = await loadMatchedFlatMap();
    const positions: Float64Array = data.pial.copyPositions();
    const faces: Uint32Array = data.chart.copyFaces();
    const ids: Uint32Array = data.chart.copyAnatomicalVertices();
    const xy: Float64Array = data.chart.copyCoordinates();
    let far = faces[0]!;
    for (const vertex of faces) if (positions[ids[vertex]! * 3]! > positions[ids[far]! * 3]!) far = vertex;
    const canvas = document.querySelector<HTMLCanvasElement>('[data-visual-qa="linked-flatmap-canvas"]')!;
    const [x0, y0, x1, y1] = data.chart.bounds;
    const scale = Math.min((canvas.width - 20) / (x1 - x0), (canvas.height - 20) / (y1 - y0));
    return [86934, far].map(v => ({
      vertex: ids[v],
      x: ((xy[v * 2]! - (x0 + x1) / 2) * scale + canvas.width / 2) / canvas.width,
      y: (((y0 + y1) / 2 - xy[v * 2 + 1]!) * scale + canvas.height / 2) / canvas.height
    }));
  });
  const marks = [];
  for (const point of points) {
    const box = (await flat.boundingBox())!;
    await flat.click({ position: { x: point.x * box.width, y: point.y * box.height } });
    await page.mouse.move(20, 20); await paint(page);
    await expect(status).toContainText('Selected face');
    expect((await pinPixels(page, flat)).count).toBeGreaterThan(12);
    const mark = await pinPixels(page, folded);
    expect(mark.count, `Folded pin for anatomical vertex ${point.vertex}`).toBeGreaterThan(12);
    marks.push(mark);
  }
  expect(Math.hypot(marks[1]!.x - marks[0]!.x, marks[1]!.y - marks[0]!.y)).toBeGreaterThan(15);
  await page.screenshot({ path: test.info().outputPath('far-side-pin.png') });

  // The reverse direction moves the same persistent mark on the flatmap.
  const prior = await pinPixels(page, flat), box = (await folded.boundingBox())!;
  await folded.click({ position: { x: box.width * .42, y: box.height * .48 } });
  await page.mouse.move(20, 20); await paint(page);
  await expect(status).toContainText('Selected face');
  const next = await pinPixels(page, flat);
  expect(next.count).toBeGreaterThan(12);
  expect(Math.hypot(next.x - prior.x, next.y - prior.y)).toBeGreaterThan(15);
  expect((await pinPixels(page, folded)).count).toBeGreaterThan(12);

  // Background clicks clear both persistent markers and the point readout.
  await flat.click({ position: { x: 2, y: 2 } });
  await page.mouse.move(20, 20); await paint(page);
  await expect(page.locator('#qf-pinned')).toHaveText('No selected point');
  expect((await pinPixels(page, folded)).count).toBe(0);
  expect((await pinPixels(page, flat)).count).toBe(0);
  expect(errors).toEqual([]);
});

test('depth is volume-only and visibly changes sampled pixels at a fixed color scale', async ({ page }) => {
  test.setTimeout(90000);
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/demo/index.html?scenario=anatomy&mode=flatmap');
  const status = page.locator('[data-linked-flatmap-status]'), depth = page.locator('#qf-depth');
  await expect(status).toContainText('Ready:', { timeout: 60000 });
  await expect(depth).toBeDisabled();
  await expect(page.locator('#qf-depth-help')).toContainText('Select Volume');
  await page.locator('#qf-source').getByRole('radio', { name: 'Volume', exact: true }).check();
  await expect(status).toContainText('Ready:', { timeout: 60000 });
  await expect(depth).toBeEnabled();
  const key = await page.locator('.anat-quant-legend').innerText();
  const flat = page.locator('[data-visual-qa="linked-flatmap-canvas"]');
  const pixels = () => flat.evaluate((canvas: HTMLCanvasElement) =>
    Array.from(canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data));
  await depth.fill('0'); await expect(status).toContainText('Ready:', { timeout: 60000 });
  await paint(page); const before = await pixels();
  await page.screenshot({ path: test.info().outputPath('depth-white.png') });
  await depth.fill('1'); await expect(status).toContainText('Ready:', { timeout: 60000 });
  await paint(page); const after = await pixels();
  await page.screenshot({ path: test.info().outputPath('depth-pial.png') });
  let represented = 0, changed = 0;
  for (let i = 0; i < before.length; i += 4) if (before[i + 3] && after[i + 3]) {
    represented++;
    if (Math.max(...[0, 1, 2].map(k => Math.abs(before[i + k]! - after[i + k]!))) >= 20) changed++;
  }
  expect(represented).toBeGreaterThan(10000);
  // A visible change over a substantial part of the cortex, not merely a changed label.
  expect(changed / represented).toBeGreaterThan(.2);
  await expect(page.locator('.anat-quant-legend')).toHaveText(key);
  await depth.focus(); await depth.press('ArrowLeft');
  await expect(depth).toHaveValue('0.95');
  await expect(status).toContainText('Ready:', { timeout: 60000 });
  await page.locator('#qf-mode').getByRole('radio', { name: 'Distortion', exact: true }).check();
  await expect(depth).toBeDisabled();
  await expect(page.locator('#qf-depth-help')).toContainText('does not affect chart distortion');
  await page.locator('#qf-mode').getByRole('radio', { name: 'Map', exact: true }).check();
  await expect(depth).toBeEnabled();
  await page.locator('#qf-source').getByRole('radio', { name: 'Surface', exact: true }).check();
  await expect(depth).toBeDisabled();
  expect(errors).toEqual([]);
});
