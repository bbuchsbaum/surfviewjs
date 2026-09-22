# Local candidate certification — 2026-08-28

## Status

The integrated working-tree candidate passes every available local gate. It is
not yet release-certified: the candidate has not been committed, required CI
has therefore not run for an exact candidate SHA, and the required macOS golden
snapshot job has not produced hosted evidence.

The candidate is an intended uncommitted change set on `main`, based on
`be3d6df79507f746edd44928fe82426774608b0f`. At measurement time that SHA was
also `origin/main`. No commit, tag, push, npm publication, release, or remote
mutation was performed.

## Environment and identity

| Surface | Version or identity |
| --- | --- |
| Local host | macOS arm64 |
| Local Node / npm | Node 26.7.0 / npm 11.19.0 |
| Supported consumer runs | Node 22.23.2 and Node 24.20.0 |
| TypeScript / ESLint | 5.9.3 / 10.9.1 |
| Vite / Vitest | 8.2.2 / 4.1.11 |
| Playwright | 1.62.1, project-managed Chromium revision 1234 |
| Three.js | 0.185.1 |
| Lockfile | SHA-256 `4169e8c5bfb8d4fe76fd3bd096ef426197d1bb3685cc2cd9e8c4c1d1a2b47471` |

`npm ci` reproduced that lockfile byte-for-byte. `npm ls --depth=0` reported a
complete direct installation with no extraneous or invalid packages.

## Gate results

| Gate | Command | Result |
| --- | --- | --- |
| Dependency policy | `npm run audit:dependencies` | Pass: zero runtime advisories, zero critical findings; one exact VitePress-nested high and two related moderates remain under dated policy |
| Source types | `npm run type-check` | Pass, strict with exact optional properties and unchecked-index checking |
| Demo types | `npm run type-check:demo` | Pass |
| Public contracts | `npm run test:types` | Pass, including expected-error contracts |
| Static analysis | `npm run lint` | Pass with ESLint 10 and no suppressions added for upgrade findings |
| Unit and coverage | `npm run test:coverage` | Pass: 67 files, 684 tests, zero skips; 65.16% statements, 58.47% branches, 74.46% functions, 66.62% lines plus higher critical-file floors |
| Focused assurance | focused Vitest command over statistics, RGBA, GPU preparation, loaders, viewer lifecycle, and WebGL lifecycle | Pass: 6 files, 107 tests |
| Transactional inputs | focused Vitest command over loaders, serialization, numerical validation, layers, temporal state, and connectivity | Pass: 9 files, 244 tests; invalid state is rejected before mutation or notification |
| Package build | `npm run build` | Pass: all six runtime entries, declarations, package declarations, compatibility aliases, and controls artifact audit |
| Bundle budgets | `npm run size` | Pass: core 118,506 B, controls 17,275 B, report 131 B, controls React 818 B Brotli |
| Deterministic performance | `npm run benchmark:check` | Pass: 32,492, 163,842, and 324,002 vertices crossed with 1, 4, and 8 layers, plus picking and bundle ceilings |
| Packed consumers | package-consumer script under exact Node 22.23.2 and 24.20.0 | Pass on both: 121 entries, 2,751,320 B packed, 11,557,532 B unpacked |
| Demo build | `npm run demo:build` | Pass, warning-clean |
| React consumer | `npm run test:react-fixture:build` | Pass, warning-clean full downstream bundle |
| Documentation | `npm run docs:build` | Pass: canonical examples, warning-fatal TypeDoc, this report, and VitePress site |
| Browser/WebGL | `npm run test:playwright` | Pass: 28/28 on project Chromium, seven workers, no skips; server exited and pre/post browser audits were clean |
| Diff hygiene | `git diff --check` | Pass |
| Tracker integrity | `mote doctor --json`; `mote fsck --json` | Pass, no warnings and no malformed or bad-hash operations after stale same-actor reservations were closed |

The final documentation build included this report and its linked assurance
pages.

## Scientific and rendering evidence

`tToZ` matches 40 values independently generated with R across degrees of
freedom 1, 2, 5, 10, 30, 31, 100, and 1,000 and statistics 0.1, 0.5, 2, 5,
and 8 to seven decimal digits. The suite separately enforces zero identity, odd
symmetry to 12 decimal digits, monotonicity, continuity within `1e-6` across the
former degree-30 branch, non-integer degrees of freedom, finite-domain errors,
and signed extreme-tail caps.

Straight-RGBA behavior has hand-derived and scalar-oracle cases for normal,
multiply, and additive modes, opacity, transparent and opaque boundaries,
ordering, and invalid inputs. The project Chromium test reads the production
shader framebuffer for 11 complete RGBA cases. Every channel is within two
8-bit units of the independent CPU oracle, WebGL2 absence is a failure, and no
case was skipped.

## Lifecycle and performance evidence

Unit lifecycle tests repeat create, queue, dispose-twice, late callback, late
restart, and listener-removal checks five times. Direct context tests require
idempotent attachment, one event per state transition, exact listener identity,
and inert callbacks after disposal. The real-browser lifecycle test proves:

- zero recurring animation frames after settling;
- no scheduled render while the WebGL context is lost;
- exactly one recovery paint after restoration;
- three invalidations coalesce into one paint; and
- disposal cancels a pending frame, detaches the canvas, and makes later start,
  render, and restore calls silent.

The largest deterministic Node case (324,002 vertices × 8 layers) remained
within the normalized ceilings; its latest local medians were 13.61 ms for CPU
composition and 3.02 ms for initial GPU-data preparation. The final full-suite
SwiftShader browser run reported medians of 15.1 ms full upload/draw, 0.4 ms
one-dirty-layer upload/draw, 6.3 ms reorder/draw, 0.3 ms visibility/draw, and
11.3 ms GPU pick for that largest case, all below the checked cross-machine
ceilings. See the [benchmark report](../performance/benchmark-report.md) for the
measurement and noise policy.

## Package and artifact evidence

The core ESM artifact is 540,422 B raw, 144,568 B gzip, and 118,506 B Brotli.
The npm archive intentionally publishes source maps only for core ESM/UMD and
their required `neurosurface.*` aliases; the consumer gate proves each alias is
byte-identical, parses core maps, and checks matching `sources` and
`sourcesContent`. It rejects maps for the embed and optional entries and
enforces 5 MiB packed and 15 MiB unpacked ceilings.

Local artifacts produced during certification are `dist/`, `coverage/`,
`demo-dist/`, `docs/.vitepress/dist/`, and the React fixture build under
`.tmp/`. CI is configured to retain coverage, benchmark/build output, and
browser failure traces. Successful package-consumer fixtures are temporary and
are removed by the gate.

## Remaining release gates and limitations

- The current candidate has no exact commit SHA. A commit is required before
  local evidence can be tied to immutable source.
- Required GitHub Actions jobs have not run for that SHA: Node 22/24 packed
  consumers, static analysis, coverage, docs/demo/React, size/performance,
  Ubuntu Chromium WebGL, and macOS controls golden snapshots remain pending.
- Local WebGL timing used ANGLE SwiftShader. It proves synchronized rendering
  behavior and enforces broad regressions, but it is not physical-GPU or
  cross-browser performance evidence.
- The supported Playwright project is Chromium. Safari and Firefox are not
  claimed by this certification.
- Stable VitePress 1.6.4 still carries its isolated Vite 5 advisory chain. The
  exact development-only exposure and next review date are recorded in the
  [tooling and supply-chain policy](./tooling-and-supply-chain.md).

After separate authorization, create one candidate commit, push it without
force, require every CI job above on the exact SHA, and record local, tracking,
and remote SHA equality. Only then may this report be promoted from local
candidate evidence to release certification.
