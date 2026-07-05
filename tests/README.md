# NeuroSurface Tests

This directory contains tests and examples for the NeuroSurface viewer, particularly focusing on GIFTI surface file support.

## Test Files

### test-gifti.html
An interactive browser-based test for loading and viewing GIFTI surfaces. It includes:
- Loading test GIFTI files from the GIFTI-Reader-JS repository
- Support for ASCII, Base64, and GZip+Base64 encoded GIFTI files
- Local file loading
- Adding data layers to surfaces
- Visual inspection of loaded surfaces

To run: `npm run test:browser` or open `tests/test-gifti.html` in a browser after running `npm run build`.

### test-crosshair-annotations.html
Minimal demo for the new interaction helpers:
- Hover crosshair (toggle)
- Click-to-add annotation
- Manual crosshair placement and annotation activation
- Clear annotations / hide crosshair

To run: open `tests/test-crosshair-annotations.html` after `npm run build`.

### test-parser.js
A Node.js test script that downloads and tests the GIFTI parser with real test files.

To run: `npm test`

### E2E visual QA specs

Playwright specs in `tests/e2e/` exercise browser-rendered demos and regression pages:
- `publication-presets.spec.ts` verifies the publication preset demo renders and `exportPNG()` returns a figure PNG.
- `new-feature-visual-qa.spec.ts` verifies linked 3D/flatmap ROI drawing/export and alignment QA slice/overlay panels with shifted-transform metrics.
- `volume-layer-webgl2.spec.ts` verifies WebGL2 volume projection parity, including fragment and ribbon modes.

To run a focused visual QA slice:

```bash
npx start-server-and-test dev:ci http://localhost:4173/demo/index.html "npx playwright test tests/e2e/new-feature-visual-qa.spec.ts"
```

## Test Data Sources

Test GIFTI files are sourced from the [GIFTI-Reader-JS](https://github.com/rii-mango/GIFTI-Reader-JS) repository:

- **ascii.surf.gii** - ASCII-encoded surface mesh
- **base64.surf.gii** - Base64-encoded surface mesh
- **tetrahedron_gzip.gii** - GZip+Base64 encoded surface mesh
- **fsaverage5-*-pial.gii** - FreeSurfer-style fixtures marked as GZip+Base64 but stored as raw zlib/deflate payloads

## Adding New Tests

1. For browser tests, create new HTML files in this directory
2. For Node.js tests, add test cases to test-parser.js or create new test files
3. Test data can be added to the `tests/data/` directory

## Known Limitations

- Only surface meshes are tested; other GIFTI data types (labels, time series) are not yet implemented

## Running All Tests

```bash
# Run parser tests
npm test

# Run browser tests
npm run test:browser

# Build and test
npm run build && npm test

# Run Playwright browser tests
npm run test:playwright
```
