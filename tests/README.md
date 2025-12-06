# NeuroSurface Tests

This directory contains tests and examples for the NeuroSurface viewer, particularly focusing on GIFTI surface file support.

## Test Files

### test-gifti.html
An interactive browser-based test for loading and viewing GIFTI surfaces. It includes:
- Loading test GIFTI files from the GIFTI-Reader-JS repository
- Support for ASCII and Base64 encoded GIFTI files
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

## Test Data Sources

Test GIFTI files are sourced from the [GIFTI-Reader-JS](https://github.com/rii-mango/GIFTI-Reader-JS) repository:

- **ascii.surf.gii** - ASCII-encoded surface mesh
- **base64.surf.gii** - Base64-encoded surface mesh
- **gzip.surf.gii** - GZip+Base64 encoded surface (not yet supported)

## Adding New Tests

1. For browser tests, create new HTML files in this directory
2. For Node.js tests, add test cases to test-parser.js or create new test files
3. Test data can be added to the `tests/data/` directory

## Known Limitations

- GZip-encoded GIFTI files are not yet supported (would require adding a decompression library)
- Only surface meshes are tested; other GIFTI data types (labels, time series) are not yet implemented

## Running All Tests

```bash
# Run parser tests
npm test

# Run browser tests
npm run test:browser

# Build and test
npm run build && npm test
```
