# SurfView test suites

SurfView separates fast source tests from public-package, browser, and visual
evidence. The required CI matrix is documented in
[the CI policy](../docs/testing/ci-policy.md).

## Unit and computational tests

`tests/unit/` contains Vitest suites for loaders, layers, statistics,
serialization, React and controls bindings, report scenes, viewer ownership,
render scheduling, WebGL resource cleanup, and pure GPU-preparation logic.
Local GIFTI fixtures cover ASCII, Base64, GZip+Base64, and raw zlib/deflate
payloads marked as `GZipBase64Binary`; tests do not download parser fixtures.

```bash
npm test
npm run test:coverage
```

The coverage command enforces global and risk-weighted per-module thresholds.
Numerical oracle and property coverage is described in
[computational assurance](../docs/testing/computational-assurance.md).

## Type and packed-package contracts

`tests/types/` holds compile-time contracts, including expected type errors.
`tests/types/package/` verifies declarations generated in `dist/`.
`npm run test:package-consumers` creates a real npm archive, installs it into
clean consumers, executes CommonJS and ESM imports, compiles every optional
entry, and runs the canonical documentation examples.

```bash
npm run test:types
npm run build
npm run test:package-consumers
```

## Browser and visual tests

`tests/e2e/` uses the project-managed Playwright Chromium build. The suite
covers surface loading and rendering, GZip GIFTI, controls, portable embeds,
React, volume projection, GPU compositing, picking, viewer lifecycle, visual
regressions, and synchronized performance budgets. WebGL absence is a failure,
not a skip.

```bash
npm run test:playwright
```

For a focused development run, keep server ownership inside
`start-server-and-test`:

```bash
npx start-server-and-test dev:ci http://localhost:4173/demo/index.html \
  "playwright test tests/e2e/new-feature-visual-qa.spec.ts"
```

The interactive pages `tests/test-gifti.html` and
`tests/test-crosshair-annotations.html` are browser fixtures used for manual
inspection and regression scenarios. Serve them through `npm run dev`; do not
open them as `file://` documents.

## Adding coverage

- Put deterministic source behavior in `tests/unit/`.
- Add compile-time public contracts to `tests/types/`.
- Add browser/WebGL behavior to `tests/e2e/` and use stable semantic or explicit
  test IDs.
- Keep all test data in `tests/data/` and record its provenance here or beside
  the fixture.
- Add or update a demo scenario for user-visible features.
- Avoid committed `.only`, silent browser skips, wall-clock-only performance
  assertions, and network-fetched fixtures.

Current surface fixtures originate from
[GIFTI-Reader-JS](https://github.com/rii-mango/GIFTI-Reader-JS). The full test
suite additionally covers label, temporal, parcellation, connectivity, volume,
and statistical-map behavior; it is not limited to mesh parsing.
