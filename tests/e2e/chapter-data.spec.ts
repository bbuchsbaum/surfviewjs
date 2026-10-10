import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';

async function openData(page: Page, query = ''): Promise<void> {
  await page.goto(`/demo/index.html?scenario=data${query}`);
  await expect(page.locator('#status-text')).toHaveText('Running: Data in & out', { timeout: 20_000 });
}

function parseOutOfBounds(report: string): number {
  const match = report.match(/out-of-bounds:\s*([0-9.]+)/i);
  if (!match) throw new Error(`Missing out-of-bounds metric in report:\n${report}`);
  return Number(match[1]);
}

/** A FreeSurfer binary triangle surface (big-endian) holding one tetrahedron. */
function freesurferTetrahedron(): Buffer {
  const header = Buffer.concat([Buffer.from([0xff, 0xff, 0xfe]), Buffer.from('created by surfview test\n\n', 'ascii')]);
  const body = Buffer.alloc(8 + 4 * 3 * 4 + 4 * 3 * 4);
  body.writeInt32BE(4, 0);
  body.writeInt32BE(4, 4);
  [0, 0, 0, 20, 0, 0, 0, 20, 0, 0, 0, 20].forEach((value, index) => body.writeFloatBE(value, 8 + index * 4));
  [0, 2, 1, 0, 1, 3, 0, 3, 2, 1, 2, 3].forEach((value, index) => body.writeInt32BE(value, 56 + index * 4));
  return Buffer.concat([header, body]);
}

const ASCII_PLY = [
  'ply', 'format ascii 1.0', 'element vertex 4', 'property float x', 'property float y', 'property float z',
  'element face 4', 'property list uchar int vertex_indices', 'end_header',
  '0 0 0', '20 0 0', '0 20 0', '0 0 20', '3 0 2 1', '3 0 1 3', '3 0 3 2', '3 1 2 3', ''
].join('\n');

test.describe('Data in & out chapter', () => {
  test('loads bundled samples and the local formats the copy names', async ({ page }) => {
    test.setTimeout(60_000);
    await openData(page);
    const loaded = page.locator('#data-load-status');
    await expect(loaded).toHaveText('fsaverage5 left pial: 10,242 vertices, 20,480 faces');
    await expect(page.locator('#viewer-frame')).toContainText(/Format\s*GIFTI, gzip base64/);

    await page.getByRole('button', { name: 'Tetrahedron' }).click();
    await expect(loaded).toHaveText('Tetrahedron: 4 vertices, 4 faces');
    await page.getByRole('button', { name: 'ASCII GIFTI' }).click();
    await expect(loaded).toContainText(/^ASCII GIFTI: [\d,]+ vertices, 10,240 faces$/);

    const input = page.locator('#data-file-input');
    const accept = (await input.getAttribute('accept'))!.split(',');
    expect(accept).toEqual(expect.arrayContaining(['.gii', '.ply', '.pial', '.white', '.inflated']));

    await input.setInputFiles({ name: 'tetra.ply', mimeType: 'text/plain', buffer: Buffer.from(ASCII_PLY) });
    await expect(loaded).toHaveText('tetra.ply: 4 vertices, 4 faces');
    await input.setInputFiles({ name: 'lh.pial', mimeType: 'application/octet-stream', buffer: freesurferTetrahedron() });
    await expect(loaded).toHaveText('lh.pial: 4 vertices, 4 faces');
    await expect(page.locator('#viewer-frame')).toContainText(/Hemisphere\s*left/);
    await input.setInputFiles('tests/data/tetrahedron_gzip.gii');
    await expect(loaded).toHaveText('tetrahedron_gzip.gii: 4 vertices, 4 faces');

    await input.setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('not a surface') });
    await expect(loaded).toContainText('notes.txt could not be loaded');
    await expect(loaded).toHaveClass(/data-error/);
  });

  test('saves, restores and shares viewer state, and downloads a scene manifest', async ({ page, context }) => {
    test.setTimeout(60_000);
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    // A restore must leave the renderer working: collect every uncaught page error.
    const pageErrors: string[] = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    await openData(page, '&mode=share');
    const threshold = page.locator('#data-threshold');
    await expect(page.locator('#data-restore')).toBeDisabled();

    await page.locator('#data-save').click();
    await expect(page.locator('#data-state-status')).toContainText(/Saved [\d,]+ chars: camera, 2 surfaces, \d+ layers/);
    const savedCanvas = await page.locator('#viewer-slot canvas').screenshot();

    await page.locator('#data-colormap').selectOption('viridis');
    await threshold.fill('3');
    await page.locator('#data-view').getByRole('radio', { name: 'Dorsal' }).check();
    await expect(page.locator('#viewer-frame')).toContainText(/View\s*Dorsal/);
    await expect.poll(async () => (await page.locator('#viewer-slot canvas').screenshot()).equals(savedCanvas)).toBe(false);
    const dorsalCanvas = await page.locator('#viewer-slot canvas').screenshot();

    await page.locator('#data-restore').click();
    await expect(page.locator('#data-state-status')).toHaveText('Restored: surfaces lh, rh');
    await expect(page.locator('#data-colormap')).toHaveValue('coolwarm');
    await expect(threshold).toHaveValue('1.65');
    // The restored film must keep rendering: it changes back from the dorsal view.
    await expect.poll(async () => (await page.locator('#viewer-slot canvas').screenshot()).equals(dorsalCanvas)).toBe(false);

    // Share link: change the scene, encode it, and open the link in a new page.
    await page.locator('#data-colormap').selectOption('RdBu');
    await threshold.fill('2.5');
    await page.locator('#data-make-link').click();
    await expect(page.locator('#data-link-status')).toContainText(/[\d,]+ chars/);
    const link = await page.locator('#data-link').inputValue();
    expect(link).toMatch(/\/demo\/index\.html\?scenario=data&mode=share#svjs=/);

    await page.locator('#data-colormap').selectOption('viridis');
    await page.locator('#data-restore-link').click();
    await expect(page.locator('#data-link-status')).toHaveText('Restored: surfaces lh, rh');
    await expect(page.locator('#data-colormap')).toHaveValue('RdBu');

    const shared = await context.newPage();
    shared.on('pageerror', error => pageErrors.push(`shared: ${error.message}`));
    await shared.goto(link);
    await expect(shared.locator('#status-text')).toHaveText('Running: Data in & out', { timeout: 20_000 });
    await expect(shared.locator('#data-link-status')).toHaveText('Opened from link. Restored: surfaces lh, rh');
    await expect(shared.locator('#data-colormap')).toHaveValue('RdBu');
    await expect(shared.locator('#data-threshold')).toHaveValue('2.5');
    expect(new URL(shared.url()).hash).toBe('');
    await shared.close();

    const sceneDownload = page.waitForEvent('download');
    await page.locator('#data-export-json').click();
    const scene = JSON.parse(await readFile((await (await sceneDownload).path())!, 'utf8'));
    expect((await sceneDownload).suggestedFilename()).toBe('surfview-scene.json');
    expect(scene.state.surfaces).toHaveProperty('lh');
    expect(scene.assets.map((asset: { id: string }) => asset.id)).toEqual(['lh-pial', 'rh-pial']);

    const htmlDownload = page.waitForEvent('download');
    await page.locator('#data-export-html').click();
    const html = await readFile((await (await htmlDownload).path())!, 'utf8');
    expect(html).toContain('id="surfview-scene-manifest"');
    await expect(page.locator('#data-export-status')).toContainText('surfview-scene.html');
    expect(pageErrors).toEqual([]);
  });

  // Migrated from new-feature-visual-qa.spec.ts "alignment QA demo renders all panels…".
  test('alignment QA renders all panels and exposes shifted-transform metrics', async ({ page }) => {
    test.setTimeout(60_000);
    await openData(page);
    await page.locator('#data-mode').getByRole('radio', { name: /alignment qa/i }).check();

    await expect(page.locator('[data-visual-qa="alignment-qa"]')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('[data-alignment-qa="workspace"]')).toBeVisible();
    await expect(page.locator('[data-alignment-qa-panel]')).toHaveCount(4);
    await expect(page.locator('[data-alignment-qa-canvas]')).toHaveCount(4);

    const report = page.locator('[data-alignment-qa-report="metrics"]');
    await expect(report).toContainText(/transform: anat-to-boldref/);
    const alignedOutOfBounds = parseOutOfBounds((await report.textContent()) ?? '');
    expect(alignedOutOfBounds).toBe(0);
    const alignedShot = await page.locator('[data-alignment-qa="workspace"]').screenshot();
    expect(alignedShot.length).toBeGreaterThan(8000);

    await page.locator('#data-transform').getByRole('radio', { name: /shifted/i }).check();
    await expect(page.locator('[data-alignment-status]')).toContainText(/shifted/);
    await expect(report).toContainText(/anat-to-boldref-shifted/);
    const shiftedOutOfBounds = parseOutOfBounds((await report.textContent()) ?? '');
    expect(shiftedOutOfBounds).toBeGreaterThan(alignedOutOfBounds);

    const shiftedShot = await page.locator('[data-alignment-qa="workspace"]').screenshot();
    expect(shiftedShot.equals(alignedShot)).toBe(false);
    // The legacy id still opens the chapter.
    await page.goto('/demo/index.html?scenario=alignment-qa&mode=alignment');
    await expect(page.locator('[data-alignment-qa="workspace"]')).toBeVisible({ timeout: 20_000 });
  });
});
