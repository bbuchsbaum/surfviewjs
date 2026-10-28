# Surface qualification, 2026-10-27

Local uncommitted implementation based on `7b44e4491c52f7cea4f0eaae6472d906de041010`. The [machine-readable receipt](receipt.json) binds results to source and runtime hashes. Earlier failed gates are retained under `history/`; infrastructure failures and the 64-subdivision timeout are retained under `logs/`. No tolerances or package-size ceilings were increased.

## Results and boundaries

| Work | Executed result | Qualification boundary |
|---|---|---|
| Optional `binary32-chart-fma-v1` with explicit radius normalization | All 16 scalar and 16 categorical comparisons on four HCP left-template routes pass; max scalar error 6.27e-7, support masks identical | Workbench 2.2.1 macOS ARM64 only; categorical gate permits exact-weight ties |
| Anatomical adaptive mapping | Eight scalar and eight categorical comparisons on fsaverage10k↔164k, both methods, full/masked, pass; max scalar error 6.97e-7, masks identical | Area metrics use corresponding anatomical midthickness; this tests numerical behavior, not anatomical registration accuracy |
| Three-frame streamed smoothing | Full 163,842-vertex 4/8 mm batches fit the default 128 MiB algorithm budget; constant error below 5e-14, all output rows supported | Single cold runs, 331 s and 83 s under different host load; process peaks 355/409 MB include parsing; no comparative speed or interactivity claim |
| Four real white/pial columns | Full-support constants, missingness and exact tetrahedral volumes pass; independent determinant relative error ≤2.1e-16, all three-seed integrations within six Monte Carlo SE | Four complete local fans, not whole cortex or clinical accuracy; Monte Carlo checks are stochastic diagnostics |
| Workbench ribbon comparison | Differences at 16 subdivisions up to 0.00133; vertex 0 remains about 0.00138 different at 32 subdivisions; 64 timed out at 240 s | Thin-column equivalence remains unqualified; sampling and warped-column model differences are not separated |
| Browser worker/render pipeline | Installed Playwright on Apple M3 Max/Metal; seven warmed samples, dynamic masks agree exactly, cancellation and visible changing pixels pass | Combined GPU upload/draw timing, not isolated upload; no frame-rate or latency-percentile guarantee |

The [sphere-area](parity/sphere-area/receipt.json) and [anatomical-area](parity/anatomical-area/receipt.json) receipts retain every case, command, fixed gate and input identity. Gates: maximum scalar error `5e-5`, RMS `1e-5`, identical valid masks, categorical equality except genuinely exact accumulated-weight ties. ASCII conversion of Workbench float32 outputs limits the displayed scalar precision. Anatomical full/masked barycentric comparisons each contain five accepted exact-vote ties. They are not scalar tolerance exceptions.

The downloaded 164k pial has a collapsed face and was rejected. Its adverse receipt is retained; the valid public midthickness supplies the 164k area metric. The 10k midthickness is the vertexwise average of corresponding white/pial surfaces, produced by the pinned Workbench binary. Both area metrics pass complete unordered face-set and vertex-count checks against the named registration sphere before binding.

## Numerical policy and regression witnesses

The default double-precision Euclidean closest-triangle method is unchanged. The optional profile specifies finite arithmetic rather than applying weight clipping to approximate another implementation:

- `R(x)` is binary32 round-to-nearest/ties-even; `F(a,b,c)` is binary32 fused product/add. Three-dimensional dot is `F(az,bz,F(ax,bx,R(ay*by)))`. Length is `R(sqrt(dot(a,a)))`; radius normalization rounds scale and each component.
- A rounded Gram–Schmidt chart projects each triangle and query. Two-dimensional dot is `F(ax,bx,R(ay*by))`. For each directed edge, a rounded unit tangent defines the inward residual of the third vertex. The query's rounded residual half-space sign classifies the face. Outside points enumerate closed projections onto violated edge constraints only.
- Chart points reconstruct world coordinates with separately rounded products/adds. Ranking uses the rounded world distance; weights use world subtriangle areas or edge coordinates. Closed-edge coefficients are bounded to [0,1] and final weights normalized. Positive interior weights are preserved.
- Packed charts cost 40 bytes/triangle. Indexed bounds include measured vertex reconstruction residual and conservative source/query rounding padding. Tests compare indexed scoring with exhaustive profile enumeration at several scales and leaf sizes.
- FMA midpoint ambiguities use exact integer comparison. Tests include an independent integer round-to-even reference across 1500 seeded exponent/cancellation cases.

The arithmetic investigation was informed by pinned GPL Workbench source and ARM64 binary behavior. The implementation uses an independent conventional chart/active-constraint construction; no Workbench branch implementation was copied or translated. Do not describe the investigation as clean-room provenance, or the profile as universal Workbench bitidentity.

Three independent one-hot cases distinguish causes: target 119351 ranks an adjacent edge above a positive-interior candidate; target 754 needs a rounded residual half-space rather than double barycentrics; target 7982 retains a tiny neighbor coefficient despite exact normalized vertex equality. See `onehot/` and the small JSON fixtures in `tests/unit/geometry/`. The last case shows why an exact-vertex shortcut changes masked support. Generic double projection retains its original behavior.

## Reproduce

Use `input-manifest.json` to fetch public HCP/TemplateFlow inputs and verify their SHA-256 hashes. HCP registration files are pinned to commit `a0937443c13092c60909e54e990c354b64f9af28`. TemplateFlow URLs are not revisioned, so matching content hashes are required. Workbench 2.2.1 ARM64 is an external reference executable, not a project dependency. Its full version/commit/compiler are recorded in each receipt. No subject data are used.

```sh
npm ci
npm run build
# Set WB_COMMAND to the external executable; HCP_FIXTURES to the sphere directory.
PROJECTION_PROFILE=binary32-chart-fma-v1 SPHERE_NORMALIZATION=radius OMP_NUM_THREADS=1 node --expose-gc scripts/qualify-template-resampling.mjs /tmp/surface-parity
# Anatomical filenames and derivation recipe are in input-manifest.json.
ANATOMICAL_SURFACES=/tmp/surfview-anatomical AREA_GEOMETRY=midthickness PROJECTION_PROFILE=binary32-chart-fma-v1 SPHERE_NORMALIZATION=radius OMP_NUM_THREADS=1 node --expose-gc scripts/qualify-template-resampling.mjs /tmp/anatomical-parity
node scripts/qualify-anatomical-ribbon.mjs /tmp/ribbon
# Requires NumPy; the retained small models can be checked without Workbench.
python3 scripts/qualify-ribbon-independent.py benchmarks/surface-geometry-qualified-evidence-2026-10-27/ribbon
node --expose-gc scripts/benchmark-streamed-batches.mjs /tmp/surfview-anatomical/fsaverage164k-midthickness.surf.gii /tmp/stream.json 8
```

`WORKBENCH_REFERENCE_ROOT` optionally reuses previously generated reference outputs after verifying geometry, area, scalar, label and ROI input identities. The final parity runs used this cache; they were not fresh executions of every full-template reference command. `external-reference-hashes.json` identifies the cached ASCII oracle assets. Boundary one-hot probes were fresh independent native executions. Native command timeouts terminate only the owned case process group.

Browser measurements use `scripts/benchmark-browser-geometry.mjs` with a lifecycle-managed local Vite server. Set `GEOMETRY_HEADED=1 GEOMETRY_GPU_PROFILE=metal` for the Metal path. Follow the repository browser-ownership audit policy. The final Metal receipt includes all source-module hashes, the worker-asset hash, renderer, browser version, launch settings, raw samples and pixel/mask/cancellation witnesses. The older software measurement has no GPU elapsed query. Heap and process RSS are observations, not allocation guarantees.

## Remaining scope

Whole-cortex ribbon validity/equivalence, right-hemisphere/population/anatomical-accuracy evidence, other Workbench builds and platforms, and broad sustained-render performance remain outside these admissions. Wide retained kernels still refuse their configured budget; streamed batches are the explicit lower-storage alternative. No dependency was added and no quality-reducing approximation was introduced. The standalone demo now serves bundled fonts and source module workers through a scoped allow list. Seven owning-chapter checks (including actual font loading) passed against this configuration. The retained user demo moved from fetch-restricted port4190 to `http://127.0.0.1:4191/`; the old server and all test browsers are closed. No code was committed, published or deployed.
