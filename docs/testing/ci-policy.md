# Continuous integration policy

SurfViewJS treats CI as a set of independent release gates. A failure in one
area cannot be hidden by success in another, and none of the required jobs is
allowed to continue on error.

## Supported Node.js releases

The package requires Node.js 22 or newer. CI exercises both Node.js 22, the
declared minimum, and Node.js 24, the current LTS line as of August 2026. This
policy follows the [official Node.js release schedule](https://github.com/nodejs/Release#release-schedule):
Node.js 18 and 20 are end-of-life, while 22 and 24 remain maintained LTS
releases. The matrix should move forward when the supported LTS set changes;
the `engines.node` declaration and the CI matrix must change together.

## Required gates

| Job | Evidence |
| --- | --- |
| Types and lint | Strict implementation and demo type-checks, public contract type-check, and ESLint |
| Dependency audit | Zero published-runtime advisories; no critical development advisories; exact reviewed VitePress-only high exception |
| Packed consumers | A real `npm pack` archive installed in clean Node 22 and 24 consumers; CommonJS root, ESM root, React, controls, controls/React, report, canonical documentation examples, and declarations are executed or compiled |
| Documentation | Warning-clean TypeDoc generation, VitePress build, linked canonical examples, and the strict demo production build |
| Unit tests and coverage | The complete Vitest suite plus global and risk-weighted per-module coverage thresholds |
| Build, size, and performance | Every distributed entry point, declaration output, bundle-size budgets, and deterministic CPU/GPU-preparation performance budgets |
| Chromium WebGL | The project-managed Playwright Chromium build on Ubuntu, including lifecycle, GPU compositing, picking, loading, and browser performance cases |
| Controls visual regression | The controls fixture on project-managed Chromium and macOS, compared with reviewed platform baselines |

Focused local tests are useful while developing, but they are not release
evidence. A candidate is CI-clean only when every required job completes for
the same revision.

## Failure evidence and anti-bypass rules

- Playwright rejects committed focused tests and WebGL absence is a failure,
  not a skip.
- Vitest rejects focused tests.
- Browser failures retain screenshots, video, and traces for artifact upload.
- The Ubuntu browser gate uses cross-platform functional and rendered-image
  invariants; a separate required macOS job enforces the reviewed pixel
  baselines instead of silently accepting missing Linux snapshots.
- Coverage, packaged build output, and benchmark measurements are uploaded as
  evidence.
- TypeDoc source checking is enabled and warnings are errors; VitePress and demo
  builds run in a separate required documentation job.
- The browser gate installs Playwright's pinned Chromium build. A system Chrome
  executable is not part of the CI path.
- The browser server is owned by `start-server-and-test`, which terminates it
  after Playwright exits.

See the [tooling and supply-chain policy](./tooling-and-supply-chain.md) for the
direct dependency inventory, package-script ownership, exact audit exception,
review date, source-map policy, and packed-size ceilings.
