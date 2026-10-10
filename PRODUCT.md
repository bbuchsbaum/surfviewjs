# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Two audiences, served equally by the demo:

- **Developers evaluating surfview**: neuroimaging tool builders (web apps, R
  htmlwidgets such as `neurosurf`, study platforms) deciding whether to adopt
  the library. Their job is to see what it can do on real cortical geometry and
  how little code each capability takes.
- **Researchers making views and figures**: cognitive and clinical
  neuroscientists who want to put their surface maps on a cortex, inspect them,
  and export publication-ready figures without writing a rendering engine.

## Product Purpose

surfview (npm `surfview`, repo `surfviewjs`) is a Three.js library for
rendering cortical surfaces with scientific data: multi-layer overlays,
thresholded statistical maps, atlases and parcellations, volume-to-surface
projection, picking and inspection, temporal playback, and figure export. The
demo gallery exists to prove these capabilities interactively and to route each
audience to the relevant API or workflow. Success: a visitor understands within
a minute what the library is for, finds the capability they care about without
wading through near-duplicates, and every scenario they open works.

## Positioning

A browser-native, dependency-light cortical surface renderer whose layer model,
threshold semantics, atlas tooling, and figure export are built for
neuroimaging conventions (GIFTI, FreeSurfer, fsaverage, fs_LR, Glasser and
Schaefer atlases, anatomical views) rather than generic 3D-mesh viewing.

## Operating Context

- Distributed as an npm package with UMD and ESM builds, a React wrapper, a
  first-party controls web component, an embed bundle, and a report-scene
  module; consumed downstream by the `neurosurf` R package.
- The demo is a Vite app in `demo/`, deployed to GitHub Pages at
  `bbuchsbaum.github.io/surfviewjs/demo/`, linked from the VitePress docs.
- The demo doubles as an end-to-end test target: Playwright specs in
  `tests/e2e/` drive it. Redesigns must update those specs alongside the demo,
  keeping real coverage. QA fixtures belong in test pages, not the public
  gallery.

## Capabilities and Constraints

- Real geometry on hand: fsaverage5 left and right pial (`tests/data/`),
  fs_LR 32k inflated left, sample GIFTI/PLY fixtures.
- Atlases on hand: Glasser HCP-MMP1.0 and Schaefer 400 (7 and 17 networks) on
  fs_LR 32k left, with licences and provenance READMEs (`demo/data/`).
- Data maps in the demo are synthetic but must be placed anatomically on real
  meshes and labelled synthetic wherever a visitor could mistake them for
  results. No new downloaded datasets.
- `three` is a peer dependency; the demo must keep working from the library's
  public exports (`src/index.ts`), not deep imports.
- WebGL2 is required for GPU compositing and 3D volume textures; CPU fallbacks
  exist.

## Brand Commitments

Name "SurfView" in the gallery, package name `surfview`. No other committed
identity assets.

## Evidence on Hand

- Real meshes and atlases listed above, with provenance.
- One synthetic functional map (`tests/data/gaussian_splat_demo.func.gii`).
- No real subject statistical maps, user testimonials, adoption figures, or
  benchmarks beyond `benchmarks/volume-projection.json` and the CI performance
  budgets; none may be invented.

## Product Principles

1. Prove on real brains: capabilities are shown on cortical geometry, not
   spheres, unless a sphere genuinely isolates the concept.
2. One home per capability: each feature is demonstrated once, at its best,
   and redundant variants are merged.
3. Show the code path: every demonstration makes the responsible public API
   visible, so developers can copy what they see.
4. Honest data: synthetic maps are labelled synthetic; claims stay factual.
5. Everything shipped works: a scenario that cannot run is removed or fixed,
   never shown broken.
