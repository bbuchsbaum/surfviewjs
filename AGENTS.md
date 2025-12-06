# Repository Guidelines

## Project Structure & Modules
- `src/`: TypeScript source for the viewer (`NeuroSurfaceViewer`, `MultiLayerNeuroSurface`), layers, loaders, utilities, and `src/react/` bindings. Keep new runtime code here.
- `dist/`: Generated ES/UMD bundles plus declaration files; never hand-edit. Regenerate via build scripts only.
- `examples/`, `demo-*.html`, `test-*.html`: Manual demos and regression test pages for visual checks.
- `tests/`: Node/browser tests and small fixtures (`tests/data`). `tests/test-parser.js` exercises the GIFTI parser with remote sample files.

## Build, Test, and Development Commands
- `npm install` — bootstrap dependencies (requires Node 18+ for Vite 5).
- `npm run dev` — Vite dev server; load demo or test HTML to iterate quickly.
- `npm run build` — clean `dist/`, run Vite build, then emit `.d.ts` via `tsc`.
- `npm run build:legacy` — Gulp pipeline for legacy bundle parity.
- `npm run preview` — serve the built bundle for smoke testing.
- `npm run type-check` — strict TypeScript check without emit.
- `npm test` — Node-based GIFTI parser smoke tests (needs network access to fetch fixtures).
- `npm run test:browser` — launches a preview and opens `tests/test-gifti.html` for manual validation.

## Coding Style & Naming Conventions
- TypeScript + ES modules; two-space indent, semicolons, single quotes. Favor named exports over defaults.
- Keep viewer- and Three.js-facing classes PascalCase; helper functions camelCase; constants SCREAMING_SNAKE_CASE.
- Place shared types in `src/types/`; React hooks/components stay in `src/react/`.
- Prefer small, pure utilities; document non-obvious math/render choices with short comments.

## Testing Guidelines
- Extend `tests/test-parser.js` for parser changes; add small fixtures to `tests/data` (avoid large binaries).
- For visual features, update or add HTML pages under `tests/`/`demo-*` and include before/after screenshots in PRs.
- Ensure `npm test`, `npm run type-check`, and relevant manual pages pass when submitting.

## Commit & Pull Request Guidelines
- Use concise, imperative commit subjects; optional scope is welcome (e.g., `fix(parser): handle base64 faces`).
- In PRs, include: summary of behavior change, testing commands run, linked issue/agenda, and screenshots or GIFs for UI/demos.
- Avoid committing rebuilt `dist/` unless the change is a tagged release or specifically requested.

## Security & Configuration Tips
- No secrets are needed; keep API keys out of the repo. Network is used only for fetching public test fixtures—pin or mirror if stability matters.
- Large assets slow installs; store new sample data externally or compress before adding to `tests/data/`.
