# Production Readiness Checklist

This library targets scientific, browser-based surface visualization. Key items to keep it stable and predictable:

- **CI & release gate**: GitHub Actions should run `npm ci`, `npm run type-check`, `npm run build`, and `npm test` (including a minimal headless/browser smoke) on pushes/PRs; publish only from clean `dist` artifacts produced in CI.
- **Packaging hygiene**: mark the package as `"sideEffects": false`; externalize `three`, `tweakpane`, `@tweakpane/plugin-essentials`, `react`, and `react-dom` in the bundle; expose explicit ESM/UMD/React entry points with matching type declarations and `typesVersions`.
- **WebGL capability guard**: fail gracefully (with a UI message) if WebGL/Canvas is unavailable instead of throwing during viewer construction.
- **Offline-safe tests**: parser tests should use local fixtures in `tests/data` rather than fetching from the network.
- **Runtime clamps & NaN guards**: clamp zoom/rotation inputs and sanitize user-provided ranges; guard SSAO/kernel and camera distance calculations against `NaN`/`Infinity`.
- **SSR friendliness**: avoid hard `window`/`document` usage at module top-level; short-circuit viewer creation when no DOM is present.
- **Docs & support matrix**: document supported browsers/GPUs, a short performance checklist (disable SSAO/shadows, reduce render size), and troubleshooting steps.
- **Bundle/size checks**: track bundle size regressions (e.g., Size Limit or Vite `--report`) to keep the library lean.

Status: CI, packaging hygiene, WebGL guard, offline tests, clamps, SSR touches, and documentation improvements are being implemented incrementally from this checklist.
