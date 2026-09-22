# Production-readiness evidence

SurfView's release gates are executable and documented rather than tracked as
an informal checklist. A candidate is ready only when every gate below passes
for the same revision in hosted CI.

| Boundary | Required evidence |
| --- | --- |
| Public API | Strict source, demo, contract, and packed-consumer type-checks |
| Numerical behavior | Independent-oracle and property tests described in [computational assurance](docs/testing/computational-assurance.md) |
| Browser lifecycle | Project-managed Chromium tests for rendering, WebGL, ownership, cleanup, and failure paths |
| Performance | Deterministic preparation budgets, synchronized browser measurements, and compressed entry budgets |
| Packaging | A real `npm pack` installed and exercised from clean Node 22 and 24 consumers |
| Dependencies | Zero runtime advisories and the exact dated development exception in the [supply-chain policy](docs/testing/tooling-and-supply-chain.md) |
| Documentation | Executed canonical examples, warning-fatal TypeDoc, VitePress, demo, and React fixture builds |

The complete job matrix, evidence retention, and anti-bypass rules are in the
[CI policy](docs/testing/ci-policy.md). Runtime ownership and failure behavior
are in [reliability and contracts](docs/guide/reliability.md). Current benchmark
workloads and ceilings are in the [benchmark report](docs/performance/benchmark-report.md).
The dated [certification report](docs/testing/final-certification.md) records
which local gates passed and which immutable-SHA hosted gates remain pending.

Local green runs establish candidate evidence. They do not prove that hosted
CI or a published npm artifact is green. Release readiness requires those
surfaces to agree on the exact candidate revision.

## Local certification commands

```bash
npm ci
npm run audit:dependencies
npm run type-check
npm run type-check:demo
npm run test:types
npm run lint
npm run test:coverage
npm run build
npm run size
npm run benchmark:check
npm run test:package-consumers
npm run docs:build
npm run demo:build
npm run test:react-fixture:build
npm run test:playwright
```

Run `npm ls --depth=0` after `npm ci` when certifying dependency installation.
The browser command owns its temporary Vite server and uses Playwright's pinned
Chromium, never an ambient system browser.
