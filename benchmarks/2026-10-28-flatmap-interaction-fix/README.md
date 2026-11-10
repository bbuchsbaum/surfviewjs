# Flatmap interaction fixes

2026-10-28. Local follow-up to the quantitative-flatmap delivery, addressing two reported demo problems. The earlier `2026-10-28-flatmap` evidence remains a historical record; this receipt supersedes its demo interaction behavior. Nothing was committed or published.

## Causes and corrections

- **Ribbon depth:** the control was enabled for vertex-scalar data, where it has no effect. The affine demonstration volume also changed very little over the few millimetres between white and pial surfaces. Depth is now enabled only for Volume in Map/Relief, with the actual sampling interval explained. The demo uses a fixed synthetic 3D wave field at the same grid resolution and color limits. Changing depth still changes only sampling locations; it never fabricates a depth-dependent source frame. The analytical benchmark's default affine field is unchanged.
- **Flatmap → folded selection:** clicks already changed the canonical anatomical point, but a small depth-tested marker could be hidden inside a sulcus or behind the visible cortex. Both views now show the exact anatomical anchor as a larger yellow overlay pin, visible through folds. This behavior is explicitly labeled. Transient hover is cyan and clears on mouse leave. An empty-map click clears both pins and stale readouts. No camera motion or anatomical displacement is introduced.
- **Evidence hygiene:** the existing visual test now writes captures to its Playwright output directory rather than replacing archived qualification images on every run.

## Verification

Two new real-browser regressions passed, exercising actual pointer clicks in both directions, near/far-side locations, persistent marker pixels, background clearing, disabled depth states, keyboard depth input, and substantial image change at a fixed color scale. Eight existing Anatomy/flatmap tests also passed, including ROI drawing/export, relief, PNG provenance, and narrow layouts.

`npm run type-check:demo`, standalone strict checking of the new test, `npm run demo:build`, and `npm run docs:build` passed. VitePress retains its existing large-chunk advisory. The unchanged library unit suite was not rerun for this demo-only correction. The owned server stopped and the final browser audit found no automated top-level browsers.

In the same 1440×900 flatmap crop, comparing depth 0 to depth 1 at fixed limits [-1.2,1.2], pixels changing by at least 20 in any RGB channel increased from **0.55% to 64.09%**. Mean maximum-channel change increased from **3.13 to 34.16**. These are visibility checks for constructed demo data, not scientific or speed benchmarks. The images, exact crop/method and raw measurements are retained in `depth-visibility.json`.

## Review

Run `npm run demo` → Anatomy → Flat map. Choose **Volume**, then move **Ribbon depth**. Click either view to move both pins.

- [Depth near white matter](depth-white.png) / [depth near pial surface](depth-pial.png)
- [Pin selected on far-side cortex through the flatmap](far-side-pin.png)
- [Narrow map](map-narrow.png) / [narrow relief](relief-narrow.png)
- [Previous white-side image](before-depth-white.png) / [previous pial-side image](before-depth-pial.png)

Reproduce the browser checks with an owned Vite server on port 4173:

```sh
npx playwright test tests/e2e/flatmap-interaction.spec.ts tests/e2e/flatmap-relief.spec.ts tests/e2e/chapter-anatomy.spec.ts --workers=1
```

The tests use the project's installed Chromium. Follow the repository browser audit and ownership rules. `source-receipt.json` records the corrected source files and evidence hashes; unrelated worktree changes remain untouched.
