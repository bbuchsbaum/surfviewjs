# Tooling and supply-chain policy

Last reviewed: 2026-08-28. Next dependency-exception review: 2026-09-30.
Owner: the SurfView maintainer.

The published `surfview` runtime has two direct dependencies, `colormap` and
`fflate`, plus the required `three` peer. React and React DOM are optional peers.
`npm run audit:dependencies` requires the installed production graph to have
zero advisories at every severity.

Development tools do not ship in the archive, but they still execute trusted
repository code and therefore remain governed. The same audit script rejects
every critical finding and every high finding except the exact reviewed
VitePress-nested Vite chain recorded below. A new advisory, changed package
path, direct high dependency, or altered advisory ID fails CI instead of being
silently absorbed by a severity count.

## Direct dependency inventory

| Packages | Why they are direct |
| --- | --- |
| `colormap`, `fflate` | Runtime color-palette generation and bounded GIFTI decompression |
| `three` and `@types/three` | Required rendering peer and compile-time API contract |
| `react`, `react-dom`, and their types | Optional React entry build, strict consumer fixture, and tests |
| `lit` | Pinned implementation of the optional controls artifact; its version-specific DOM-less transform is audited during build |
| `vite`, `terser` | The one library/demo build generation and its explicitly selected minifier, currently Vite 8 with Rolldown |
| `typescript`, `@types/node`, `@types/colormap` | Source, declaration, config, and dependency type-checking |
| `vitest`, `@vitest/coverage-v8`, `jsdom` | Unit execution, risk-weighted coverage, and DOM lifecycle tests |
| `@playwright/test` | Project-controlled Chromium WebGL, lifecycle, and visual gates |
| `eslint`, `@eslint/js`, `typescript-eslint`, `globals` | Source static analysis |
| `typedoc`, `typedoc-plugin-markdown`, `typedoc-vitepress-theme`, `vitepress` | Warning-fatal API extraction and the guide site |
| `size-limit`, `@size-limit/file` | Independent compressed budgets for publishable entries |
| `start-server-and-test` | Owns temporary local/CI Vite servers around Playwright runs |

Gulp, Webpack CLI, `node-fetch`, direct Rollup 2, the Rollup 2 plugins, and
`rollup-plugin-terser` were removed after repository-wide searches found no
implementation. The `build:legacy` script was removed because no gulpfile
existed. Node 22 supplies `fetch`; Vite owns the active bundler integration,
while Terser is direct because Vite treats the selected minifier as an optional
peer.

Three visible major-version holds are deliberate compatibility boundaries, not
unreviewed drift. `@types/node` stays on 22 so declarations and repository code
cannot accidentally depend on APIs newer than the declared minimum Node line.
React, React DOM, and their types stay on 18 because that is the current public
optional-peer contract; React 19 admission requires an explicit consumer and
StrictMode compatibility change. TypeScript stays on 5.9 because
`typescript-eslint` 8.68 declares support below TypeScript 6.1, so the current
TypeScript 7 release is outside the lint toolchain's supported peer range.

## Reviewed development-only exception

The latest stable VitePress release is `1.6.4` and installs its own Vite 5
generation. That nested Vite retains one high development-server path-traversal
advisory and one moderate optimized-source-map advisory; its nested esbuild also
retains a moderate development-server cross-origin advisory. There is no fixed
stable VitePress version. Upstream Vite 8 support is tracked in
[vuejs/vitepress#5201](https://github.com/vuejs/vitepress/issues/5201).

Exposure is constrained:

- the packages are absent from `npm audit --omit=dev` and the published archive;
- CI runs `vitepress build` on a trusted checkout and does not expose its dev
  server;
- `docs:dev` binds locally by default and must not be exposed to an untrusted
  network; and
- the allowlist names only `node_modules/vitepress/node_modules/vite` and
  [GHSA-fx2h-pf6j-xcff](https://github.com/advisories/GHSA-fx2h-pf6j-xcff).

At the review date, check for a stable VitePress release that no longer nests a
vulnerable Vite. Remove the allowlist as soon as the docs build passes on that
release. If the exception expands, becomes runtime-reachable, or gains a
critical advisory, the gate fails and release is blocked.

## Package scripts

Every package script is either a required gate, a helper invoked by one, or a
documented local workflow.

| Script | Purpose |
| --- | --- |
| `build` | Required publishable core/embed/React/report/controls build plus declarations and artifact audits |
| `clean`, `build:types`, `test:package-types`, `check:controls-artifacts` | Internal build stages invoked by `build` |
| `type-check`, `type-check:demo`, `test:types`, `lint` | Required implementation, demo, public-contract, and lint gates |
| `test`, `test:coverage` | Complete local unit run and required CI coverage run |
| `test:package-consumers` | Required clean `npm pack` imports, strict declarations, examples, compatibility aliases, maps, and archive ceilings |
| `test:docs-examples`, `docs:api`, `docs:build` | Canonical example linkage, warning-fatal TypeDoc, and required VitePress build |
| `demo:build`, `test:react-fixture:build` | Required strict demo and downstream React production builds |
| `audit:dependencies` | Required zero-runtime and reviewed-development advisory policy |
| `size`, `benchmark:check` | Required bundle and deterministic performance ceilings |
| `test:playwright` | Required full project-Chromium browser/WebGL gate |
| `dev:ci`, `playwright:test` | Internal server and runner commands invoked by `test:playwright` |
| `prepublishOnly` | npm lifecycle guard that rebuilds the archive before publication |
| `dev`, `demo` | Local source and scenario development servers |
| `test:watch`, `lint:fix` | Local iterative test and explicit lint-rewrite workflows |
| `benchmark:performance`, `benchmark:browser` | Local reference regeneration and focused synchronized browser profiling |
| `docs:dev`, `docs:preview` | Local documentation authoring and built-site review |

Removed scripts (`build:legacy`, `test:legacy`, `test:browser`, and the generic
library `preview` variants) either named no implementation, duplicated required
gates, or could not serve the documented fixture from their configured root.

## Source maps and archive size

The package intentionally publishes source maps only for the core ESM/UMD
artifacts and their historical `neurosurface.*` aliases. The downstream
`neurosurf` htmlwidget/pkgdown sync path still consumes those filenames.
Because SurfView is open source, matching `sourcesContent` is deliberate and is
validated byte-for-byte along with the compatibility aliases.

The self-contained embed and optional React, report, and controls entries do not
publish maps. Their maps provided no compatibility contract and the embed map
alone added roughly 5 MiB unpacked. The packed-consumer gate rejects those maps,
requires the core maps, and caps the npm tarball at 5 MiB and its unpacked
contents at 15 MiB. Bundle execution budgets remain separate from archive-size
and source-map policy.

## Reproduction

```bash
npm ci
npm ls --depth=0
npm run audit:dependencies
npm run build
npm run test:package-consumers
```

`npm ci` is the lockfile reproducibility test. It must complete without changing
`package-lock.json`; all later gates run on that exact installation.
