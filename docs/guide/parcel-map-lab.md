# Parcel map laboratory

Open the [2D parcel map laboratory in the demonstration gallery](https://bbuchsbaum.github.io/surfviewjs/demo/?scenario=parcel-map-lab&dataset=glasser),
or use the [standalone laboratory](https://bbuchsbaum.github.io/surfviewjs/demo/map-lab.html?dataset=glasser).

The map laboratory unfolds the cortical parcel sheet into a fitted 2D map, then
lets you trade local angle fidelity against parcel areas and compactness. Shared
boundaries move together. Clicking a tile reveals its original curved 3D shell.

Run `npm run demo` and open `/map-lab.html`, or choose **2D parcel map laboratory**
in the demo gallery. With the repository-root dev server, open
`/demo/map-lab.html`. The [3D puzzle](./parcel-puzzle.md) remains available as a
separate view.

This is an experimental optimizer for exploring layouts. It does not certify a
global optimum, and its source areas and angle measurements describe the supplied
surface. The sample cortical data use an **inflated** fsLR 32k surface, not native
cortical areas or measured cortical thickness.

## Explore the parameters

Start with **Compare three balances**. It runs fidelity, balanced, and tile-emphasis
settings from the same harmonic map and retains four comparison cards, including
the starting map. Click a card to restore its coordinates and optimization goals.
Each run is bounded to 80 steps; use **Optimize 80 steps** again to continue.

| Control | Meaning |
| --- | --- |
| Dataset | Real left-hemisphere Schaefer–Yeo 400 (200 parcels), Glasser (180), or a synthetic nine-piece sheet. |
| Outline | Fixed convex disk, rounded square, or nearly square. |
| Aspect ratio | Width divided by height of the target outline. |
| Angle fidelity | Weight of local conformal distortion relative to the source surface. |
| Area matching | Weight of errors against the chosen parcel-area targets. |
| Compact pieces | Weight of reciprocal compactness, penalizing irregular or elongated pieces. |
| Area target | Interpolates from source-area proportions to equal display area per parcel. |
| Deformation detail | Resolution of a smooth control lattice. Finer controls allow more localized changes. |

Changing the outline, aspect ratio, or dataset rebuilds the starting map and clears
comparisons. Changing a goal keeps the current coordinates and, by default, starts
a new bounded optimization run. Turn off **Optimize after changing a goal** to set
several goals before running. **Reset map** restores the original harmonic layout
and retains the current goals.

**Color by area relative to target** reveals parcels that are too small or too
large under the current target. **Color by compactness** shows where tile shapes
remain awkward. **Overlay starting boundaries** makes deformation visible. The
parcel menu provides a keyboard alternative to clicking a tile.

## Metrics and objective

For each parcel, let `A` denote its current planar area, `P` its perimeter,
and `T` its target area. Targets sum to the fixed map area:

\[
T_p=A_{\mathrm{map}}\left[(1-\alpha)
\frac{A^{\mathrm{source}}_p}{\sum_q A^{\mathrm{source}}_q}
+\frac{\alpha}{N}\right].
\]

The displayed area mismatch is
`100 × sqrt(sum((A - T)² / T) / mapArea)`. It is an RMS relative error weighted by
target area, and may exceed 100%. Comparison cards can have different targets;
their area errors are relative to their own targets.

Local angle distortion is `||J||² / (2 det(J)) - 1`, where `J` maps an intrinsic
2D coordinate frame of a source triangle to its current planar triangle. It is
zero for a similarity transformation. The reported value averages over triangles
using their source areas.

Compactness is `C = 4πA/P²`. A circle has compactness 1. The displayed statistic is
the mean `C`, while the optimization penalty is the mean `1/C - 1`; this places
more emphasis on poorly shaped parcels. All boundary components, including holes
and disconnected parts of a parcel, contribute to its perimeter.

The objective is the weighted sum of angle distortion, squared area mismatch,
and reciprocal-compactness penalty. Raw objective values from different weight
settings are not directly comparable. A decreasing objective does not require
every individual metric to improve.

## Geometry and constraints

The laboratory uses the same indicator-interpolated partition as the 3D puzzle.
Vertices, edge midpoints and three-label junctions are shared between neighboring
parcels. The mesh retains its triangle connectivity and triangle-to-parcel labels
throughout optimization. It does not substitute Voronoi cells or infer borders
from parcel centroids.

The input partition must be a consistently wound, connected manifold disk with
one simple boundary loop. The sample Schaefer and Glasser partitions meet these
checks after the background/medial-wall label is omitted. Unsupported topologies
are rejected; no extra internal cuts are made automatically.

Initialization solves a positive weighted harmonic system with a convex boundary.
Weights are symmetrized positive mean-value weights computed on the source
triangles. This follows the positive convex-combination approach to injective
disk parameterization described in the
[CGAL surface parameterization manual](https://doc.cgal.org/latest/Surface_mesh_parameterization/index.html).
The iterative solve reports its relative residual and rejects a nonconverged or
flipped result.

The experimental optimizer projects the analytic objective gradient onto a
bilinear control lattice, with a taper near the outside edge. Backtracking accepts
a step only when the objective decreases and every triangle retains positive
orientation and at least `1e-4` of its initial planar area. The fixed boundary is
validated as simple and convex. On this disk, these conditions protect the
one-to-one map and its parcel contacts, subject to floating-point tolerances.
The guarantee applies to accepted maps; no continuous 3D unfolding animation is
implemented by this laboratory.

The fixed perimeter allocation is a significant restriction. Parcels touching
the medial wall can occupy large arcs of the outer rim; equalizing their areas
may make them thin or elongated. A run can reach a local or resolution-dependent
limit. The controls and comparisons are intended to expose those tradeoffs.

## Use the numerical API

```ts
import {
  buildParcelMapMesh, flattenParcelMap, ParcelMapOptimizer,
  DEFAULT_PARCEL_MAP_PARAMETERS
} from 'surfview';
import type { ParcelPuzzleInput } from 'surfview';

async function makeParcelMap(input: ParcelPuzzleInput, signal: AbortSignal) {
  const mesh = buildParcelMapMesh(input);
  const coordinates = await flattenParcelMap(mesh, {
    signal,
    boundaryShape: 4,
    aspectRatio: 1.2
  });
  const optimizer = new ParcelMapOptimizer(mesh, coordinates, {
    ...DEFAULT_PARCEL_MAP_PARAMETERS,
    areaWeight: 3,
    equalArea: 0.5
  });
  for (let i = 0; i < 80; i++) {
    signal.throwIfAborted();
    if (!optimizer.step().accepted) break;
    await new Promise<void>(resolve => setTimeout(resolve, 0));
  }
  return { mesh, coordinates: optimizer.coordinates.slice(), metrics: optimizer.measure() };
}
```

The numerical API creates no DOM or renderer. Treat returned mesh arrays and
optimizer coordinates as read-only during a solve; use `reset()` or `restore()` to
change an iterate. `restore()` checks the fixed boundary and triangle areas.
This experimental API may evolve as the geometry model develops.

## Retain an experiment

**Keep this map** retains up to four in-memory coordinate snapshots with their
goal settings. **Export map & parameters** downloads JSON containing the source
metadata, source geometry of the partition, triangle ownership, initial and
optimized planar coordinates, boundary, goals, and measured metrics. Accepted
step counts are counted since the latest reset or restore. The export contains
display geometry; it is not an anatomical measurement result.

`node scripts/build-parcel-puzzle-demo.mjs` creates offline HTML copies of both
the puzzle and the map laboratory under `output/concepts/`, with embedded sample
data, provenance and atlas licenses.
