import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('surfview/controls package boundary', () => {
  it('does not explicitly register the source entry during import', async () => {
    // Lit's Node export supplies its own SSR registry. Install a sentinel so
    // this unit isolates SurfView's behavior; the built artifact is exercised
    // with genuinely absent DOM globals by check-controls-artifacts.mjs.
    const registry = {
      define: vi.fn(),
      get: vi.fn()
    } as unknown as CustomElementRegistry;
    vi.stubGlobal('customElements', registry);
    const controls = await import('../../src/controls-ui/index');

    expect(registry.define).not.toHaveBeenCalled();
    expect(controls.SURFVIEW_CONTROLS_TAG).toBe('surfview-controls');
    expect(() => controls.defineSurfViewControlsElement()).toThrow(
      /require a browser DOM/
    );
  });

  it('publishes an ESM-only optional subpath and independent size gate', () => {
    const packageJson = JSON.parse(readFileSync(
      new URL('../../package.json', import.meta.url),
      'utf8'
    ));

    expect(packageJson.exports['.']).toEqual({
      types: './dist/types/index.d.ts',
      import: './dist/surfview.es.js',
      require: './dist/surfview.umd.js'
    });
    expect(packageJson.exports['./react']).toEqual({
      types: './dist/types/index.react.d.ts',
      import: './dist/surfview.react.es.js',
      default: './dist/surfview.react.es.js'
    });
    expect(packageJson.exports['./controls']).toEqual({
      types: './dist/types/controls-ui/index.d.ts',
      import: './dist/surfview.controls.es.js',
      default: './dist/surfview.controls.es.js'
    });
    expect(packageJson.exports['./controls']).not.toHaveProperty('require');
    expect(packageJson.exports['./controls/react']).toEqual({
      types: './dist/types/controls-ui/react.d.ts',
      import: './dist/surfview.controls.react.es.js',
      default: './dist/surfview.controls.react.es.js'
    });
    expect(packageJson.exports['./controls/react']).not.toHaveProperty('require');
    expect(packageJson.exports['./report']).toEqual({
      types: './dist/types/index.report.d.ts',
      import: './dist/surfview.report.es.js',
      default: './dist/surfview.report.es.js'
    });
    expect(packageJson.exports['./report']).not.toHaveProperty('require');
    expect(packageJson.sideEffects).toEqual([
      './dist/surfview.es.js',
      './dist/surfview.umd.js',
      './dist/surfview.embed.iife.js',
      './dist/surfview.report.es.js'
    ]);
    // The controls build contains audited, version-specific DOM-less import
    // transforms for Lit. Upgrades must be deliberate rather than semver-drifted.
    expect(packageJson.dependencies).not.toHaveProperty('lit');
    expect(packageJson.devDependencies.lit).toBe('3.3.3');
    expect(packageJson['size-limit']).toEqual(expect.arrayContaining([
      expect.objectContaining({
        name: 'Controls ESM bundle',
        path: 'dist/surfview.controls.es.js'
      }),
      expect.objectContaining({
        name: 'Report ESM adapter',
        path: 'dist/surfview.report.es.js'
      }),
      expect.objectContaining({
        name: 'Controls React ESM bundle',
        path: 'dist/surfview.controls.react.es.js'
      })
    ]));
  });

  it('publishes report as a thin compatibility re-export of core', () => {
    const reportEntry = readFileSync(
      new URL('../../src/index.report.ts', import.meta.url),
      'utf8'
    );
    const buildSource = readFileSync(
      new URL('../../vite.config.report.js', import.meta.url),
      'utf8'
    );

    expect(reportEntry).toMatch(/from ['"]\.\/index['"]/);
    expect(reportEntry).not.toMatch(/controls-ui|\bfrom ['"]lit/);
    expect(buildSource).toContain("id: './surfview.es.js', external: true");
    expect(buildSource).toContain("entry: resolve(__dirname, 'src/index.report.ts')");
  });

  it('keeps the React adapter thin and free of import-time registration', async () => {
    const registry = {
      define: vi.fn(),
      get: vi.fn()
    } as unknown as CustomElementRegistry;
    vi.stubGlobal('customElements', registry);
    const adapter = await import('../../src/controls-ui/react');
    const buildSource = readFileSync(
      new URL('../../vite.config.controls-react.js', import.meta.url),
      'utf8'
    );

    expect(adapter.SurfViewControls.displayName).toBe('SurfViewControls');
    expect(registry.define).not.toHaveBeenCalled();
    expect(buildSource).toContain("id: './surfview.controls.es.js', external: true");
    expect(buildSource).toContain("external: ['react', 'react-dom', 'react/jsx-runtime']");
    expect(buildSource).not.toMatch(/src\/controls-ui\/index\.ts/);
  });

  it('keeps the root source entry independent of the optional UI entry', () => {
    const rootSource = readFileSync(
      new URL('../../src/index.ts', import.meta.url),
      'utf8'
    );
    const buildSource = readFileSync(
      new URL('../../vite.config.controls.js', import.meta.url),
      'utf8'
    );

    expect(rootSource).not.toMatch(/controls-ui|SurfViewControlsElement|mountSurfViewControls/);
    expect(buildSource).toContain("entry: resolve(__dirname, 'src/controls-ui/index.ts')");
    expect(buildSource).toContain("id: './surfview.es.js', external: true");
    expect(buildSource).not.toMatch(/external:\s*\[[^\]]*['"]lit['"]/);
  });

  it('keeps compact report controls independent of the optional Lit panel', () => {
    const reportControlsSource = readFileSync(
      new URL('../../src/report/ReportControls.ts', import.meta.url),
      'utf8'
    );

    expect(reportControlsSource).not.toMatch(/controls-ui|\bfrom ['"]lit/);
    expect(reportControlsSource).toMatch(/createSurfViewControlSession/);
    expect(reportControlsSource).not.toMatch(
      /setAttribute\(['"]role['"],\s*['"]toolbar/
    );
  });
});
