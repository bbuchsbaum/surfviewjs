# Normal volume projection benchmark

Local CPU measurements for `projectVolume`, recorded 2026-10-08. These are synthetic Node timings, not browser frame rates or a comparison against the previous renderer.

- Hardware/runtime: Apple M3 Max, darwin arm64, Node v26.7.0.
- Workload: 256 × 256 × 256 Float32 volume (64 MiB), Fibonacci sphere of radius 80 mm, depths [-2, 2] mm, mean reduction, all samples valid, no mask.
- Each case: 2 warm-up calls, then 7 timed calls. Input construction and correctness checks are excluded; input validation, affine inversion and output allocations are included.
- The table reports median ± median absolute deviation in milliseconds. It is a local snapshot; system load and vertex ordering affect the results.
- The 164k-to-324k linear timings are noisy and consistent with cache-sensitive performance; these measurements do not establish linear time scaling. The archived bundle hash identifies the measured implementation, before later viewer fixes and legacy sampler caching.
- Correctness: every output is finite with the expected sample count; selected vertices are compared with an independent analytic field calculation. Unit tests separately cover nonlinear fields, masks, missing data and oblique transforms.
- Output arrays use 8 bytes per vertex (Float32 values and Uint32 counts). The volume buffer is borrowed.

| Vertices | Samples | Nearest (ms) | Linear (ms) |
| ---: | ---: | ---: | ---: |
| 32,492 | 5 | 14.5 ± 2.2 | 21.7 ± 2.5 |
| 32,492 | 16 | 26.9 ± 1.1 | 52.5 ± 3.7 |
| 163,842 | 5 | 58.5 ± 9.3 | 85.6 ± 2.9 |
| 163,842 | 16 | 109.6 ± 6.2 | 263.0 ± 33.5 |
| 324,002 | 5 | 94.0 ± 3.1 | 264.4 ± 42.9 |
| 324,002 | 16 | 325.9 ± 75.7 | 508.2 ± 4.2 |

Larger cases take hundreds of milliseconds synchronously. Project once and reuse the scalar values for display changes; applications needing uninterrupted interaction during repeated projection can run the function in a worker.

## Reproduce

```sh
npm run build
node scripts/benchmark-volume-projection.mjs --output=/tmp/volume-projection.json
```

The repository retains full measurements, variability and the exact built ESM SHA-256 in `benchmarks/volume-projection.json`. No timing threshold is imposed on CI.

[API contract and example](../guide/layers.md#numerical-projection-along-normals)
