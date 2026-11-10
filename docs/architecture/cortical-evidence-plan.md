# Cortical evidence inspection: implementation plan

Date: 2026-09-12

Status: Proposed design; implementation has not started.

Basis: The current working checkout, including its uncommitted controls,
rendering, reliability, and parcel-map work. Recheck these seams before coding.

## 1. Outcome and scope

Add evidence inspection to SurfView so a reader can select a cortical location
or region, inspect the participant observations behind a paired contrast, and
save a report that reconstructs that exploration.

SurfView continues to accept estimated, spatially aligned data from its host.
The addition owns descriptive reductions, their connection to displayed maps,
and inspection of their contributors. Model fitting, registration, and
inferential calibration remain upstream responsibilities.

The first release supports one two-condition contrast, one estimate per
participant and condition, and one or two explicitly identified surface
domains. It includes vertex inspection, parcel and ROI summaries, participant
inspection, an explicitly selected participant subset, and portable replay.
This is one complete workflow. Pipeline comparisons and other experimental
dimensions follow after this workflow is qualified.

The feature can be called **Evidence** in the UI. `SurfaceEvidence` is the
proposed public data abstraction. Names and signatures below are design
proposals, not existing APIs.

## 2. Decisions that preserve cohesion

1. Derived maps are ordinary `DataLayer` instances. Evidence does not introduce
   a layer subclass, shader, compositor, camera, or renderer.
2. Observation data and reduction code live in a focused `src/evidence/`
   module. They do not live in `NeuroSurfaceViewer` or a control component.
3. Existing inspection identifies vertices and parcels. Existing `VertexROI`
   objects identify drawn regions. These objects keep their existing meanings.
4. Evidence is an optional capability of the existing control target and
   session system. DOM and React controls use the same descriptors and commands.
5. Evidence reports extend the existing portable report path. They reuse its
   asset descriptors, binary codecs, checksum verification, and mount lifecycle.
6. Use the current package entry points: pure data and binding APIs through
   `surfview`, UI through `surfview/controls`, and report helpers through
   `surfview/report`. A new package or `surfview/evidence` subpath is not needed
   for this release. Keep the existing optional UI boundary and bundle budgets.
7. There is no general expression language, arbitrary computation graph,
   notebook system, new plugin framework, or generic dashboard API in this work.

## 3. Existing seams and the changes they need

Paths in this table link to the implementation inspected for this plan.

| Existing owner | Existing behavior | Proposed extension |
| --- | --- | --- |
| [DataLayer](../../src/layers.ts) | Scalar values, revisions, sampling, summaries, presentation metadata, compositing | A binding updates the data and presentation of an explicitly assigned scalar output layer. Its mapping controls continue to work normally. |
| [Inspection](../../src/Inspection.ts) and [viewer selection](../../src/NeuroSurfaceViewer.ts) | Canonical `none`, `vertex`, or `parcel` selection | Evidence follows committed selection events. Keep the public selection union and `VertexInspection` unchanged in this release. |
| [ParcelSurface](../../src/surfaces/ParcelSurface.ts) | Canonical atlas labels and parcel membership | Use `getVertexIndicesForParcel()` for aggregation. A representative vertex remains a locator, not a parcel statistic. |
| [ROI utilities](../../src/roi.ts) and [FlatMapView](../../src/FlatMapView.ts) | `VertexROI`, drawing, and ROI creation/update/removal events | Consume validated ROI membership and existing events; preserve a membership snapshot when saving an exploration. |
| [LinkedBrainWorkspace](../../src/LinkedBrainWorkspace.ts) | Hover, flatmap selection, layer, and time synchronization | Add canonical inspection synchronization when the viewer exposes it, retaining the existing lightweight-viewer fallback. |
| [ControlTarget](../../src/controls/ControlTarget.ts), [ControlSession](../../src/controls/ControlSession.ts), and [target registry](../../src/controls/ControlTargetRegistry.ts) | Immutable descriptors, commands, canonical state, and independent panel focus | Add an optional evidence capability and lazy detail query. Reuse the managed target; do not create an independent evidence-panel state store. |
| [ReportSceneControlTarget](../../src/report/ReportSceneControlTarget.ts) | Report labels, units, bilateral layout, and one displayed map | Carry evidence state through this adapter and preserve its display policy. Dynamic evidence labels must agree with the committed data. |
| [Portable scene manifest](../../src/scene/SceneManifest.ts), [binary assets](../../src/scene/BinaryAssets.ts), and [SceneMount](../../src/report/SceneMount.ts) | Validated assets and reconstructable scalar scenes | Add an independently versioned evidence section with separately loaded observation assets. Hydrate existing parcel types when that section supplies an atlas. |
| [Figure export](../../src/viewer/FigureOverlayRenderer.ts) and [AtlasFigure](../../src/atlas/AtlasFigure.ts) | Raster figure overlays and composed atlas plates | Reuse current figure appearance and export controls. A static image remains a static image; replay is delivered by the evidence report. |

Three implementation details require explicit treatment:

- `LinkedBrainWorkspace` currently mirrors some selections through crosshairs
  and legacy parcel events. That is not sufficient to make every selection a
  canonical scientific selection. Repair this narrow synchronization seam.
- Portable `SceneMount` currently constructs `MultiLayerNeuroSurface`, not
  `ParcelSurface`. An exported parcel workflow therefore needs explicit atlas
  hydration; loading scalar maps alone cannot reproduce parcel inspection.
- `serialization/SceneExporter.ts` and `scene/SceneManifest.ts` both use
  `surfview.scene.v1`, but describe different object shapes. Evidence extends
  the latter, which `mountSurfView()` consumes. Validate the object shape as
  well as the version. Do not expand this work into a migration of both formats.

## 4. First-release workflow

The host supplies registered cortical geometry, participant IDs, two condition
maps per participant, a contrast direction, and optional atlas/ROI information.

The viewer starts with the mean of the participants' paired differences. The
existing selection section gains an Evidence subsection when the focused or
report-displayed layer has evidence attached.

- Selecting a vertex shows its condition values and paired difference for each
  participant, together with valid and missing counts.
- Selecting a parcel resolves its full vertex membership and shows one region
  summary per participant. The UI names the spatial weighting and coverage rule.
- Choosing an existing ROI uses its membership. The demo also exposes the
  existing flatmap lasso; arbitrary 3D lasso drawing is outside this release.
- Clicking a participant row or plot point displays that participant's
  difference map. Hover only highlights the row; it does not recompute a map.
- Brushing participants previews a selection. An explicit **Use selected
  participants** action changes the displayed descriptive mean. The full-cohort
  reference remains visible in the plot and can be restored in one action.
- **Save evidence report** captures the committed map, query, participant IDs,
  region membership, input assets, and derivation. Reopening it restores those
  values and the ability to continue inspecting them.

The same output-layer address is retained when changing between the reference
mean, selected-participant mean, and individual map. Geometry, camera, layer
order, colormap, and user-selected display limits need not be recreated.

## 5. Scientific and data contract

### 5.1 Inputs and correspondence

`SurfaceEvidence` holds immutable metadata and owned numeric inputs:

- Stable dataset, participant, condition, observation, and domain IDs.
- Exactly two named conditions for the selected contrast, with its direction
  recorded explicitly as A minus B.
- One Float32 scalar map per participant, condition, and declared domain.
  Duplicate identities are errors. An absent condition is recorded as missing;
  it is never paired by array position or substituted from another run.
- An explicit domain description: hemisphere, vertex count, source template and
  version, vertex-correspondence identity, and provenance of registration.
- An optional fixed analysis mask, atlas labels using `ParcelData`, and named
  `VertexROI` definitions. The default analysis mask is the full declared domain;
  a medial-wall exclusion must be supplied rather than inferred from zeros.
- A quantity identifier and units shared by the two conditions. Incompatible
  quantities, units, or domains fail before a derived layer is changed.

Version 1 accepts dense maps. Sparse inputs can be normalized by the host;
support for a second storage representation is deferred until a real consumer
needs it. Finite values and `NaN` are allowed; infinities are rejected. Zero is
a valid observation.

Equal array length or matching topology does not establish anatomical
correspondence. The producer must supply an explicit correspondence identity.
Checksums verify assets, not the scientific validity of registration. Pial,
inflated, and flat display variants can share an evidence domain when the
producer identifies the same vertex correspondence.

Copy caller arrays at ingestion and keep the owned copies private. Readonly
TypeScript annotations do not make a typed array immutable. A dataset revision
changes only through an explicit replacement operation, not through edits to
caller storage. No data acquisition or network request occurs on module import.

### 5.2 Paired contrast and map reduction

For participant `s` and vertex `v`, define:

```text
d(s, v) = A(s, v) - B(s, v), when both values are finite;
          missing, otherwise.

E(v, S) = participants in selected set S with a valid pair at v
n(v, S) = |E(v, S)|
mean(v, S) = sum over s in E(v, S) of d(s, v) / n(v, S)
```

The observational unit is the participant. Compute paired differences before
averaging participants. Runs must already have been reduced upstream; runs and
future pipeline variants cannot silently increase the participant count.

An empty eligible set produces missing data and count zero. An empty user subset
is an explicit empty result, not a request to restore the full cohort.
Vertices outside the fixed analysis mask produce missing map values and count
zero regardless of their stored observations.

Use Float64 arithmetic for differences and reductions, with a fixed canonical
participant order. Convert to Float32 once when materializing a `DataLayer`.
Report missing values as `null` in JSON descriptors and `NaN` in numeric map
assets. Counts use integer storage. Input and output overflow are explicit
errors, not missing observations.

The full-cohort reference is fixed by dataset and contrast revision. Picking a
region, changing a display threshold, or brushing observations does not redefine
that reference.

### 5.3 Parcel and ROI reduction

Resolve region membership `R` in the declared domain and intersect it with the
fixed analysis mask. Reject out-of-domain indices and an incompatible atlas.
Canonicalize valid membership as a sorted set; use its content to identify a
revision rather than relying only on an editable ROI timestamp.

Require a declared spatial weighting:

- `vertex`: equal weight per included vertex.
- `reference-area`: a supplied nonnegative per-vertex area vector with a named
  anatomical reference and units. Area must not be derived from the current
  inflated mesh, flattened layout, or camera projection.

Zero-weight vertices do not contribute. A zero total region weight is an empty
region. Let `R_s` contain region vertices with finite A and B for participant `s`.

```text
coverage(s, R) = sum of weights in R_s / sum of weights in R
r(s, R) = sum over v in R_s of w(v) * d(s, v) / sum of weights in R_s
```

Both condition summaries use that same paired support. A participant's region
value is eligible only when coverage meets the recorded minimum. The first
release uses minimum coverage 1: every positively weighted region vertex must
have a valid pair. Partial coverage is still reported, and the excluded row
remains inspectable. Decide eligibility from that complete-pair membership,
not from a rounded coverage fraction that could hide a missing low-weight vertex.
A future relaxed-coverage policy needs its own explicit
contract and fixture; it is not an unlabeled default in this release.

The group region result is the equal-participant mean of eligible `r(s, R)`.
It is not obtained by averaging visible colors or reading the representative
vertex. With missing data, it can differ from the spatial average of a group
map because participant eligibility varies by vertex. The detail view reports
the region estimand and denominator directly.

Version 1 provides paired observations, descriptive means, coverage, and counts.
It does not generate confidence intervals, p-values, significance labels, or a
generic robustness score. Filtering participants changes the displayed
descriptive result; it does not refit an upstream statistical model.

A small acceptance example makes the missingness rule concrete. For a two-vertex
region with weights `[1, 3]`, suppose the paired differences are:

| Participant | Vertex 1 | Vertex 2 | Region coverage | Eligible region mean |
| --- | ---: | ---: | ---: | ---: |
| P1 | 2 | 4 | 1 | 3.5 |
| P2 | 6 | missing | 0.25 | missing |
| P3 | -2 | 0 | 1 | -0.5 |

The group map is `[2, 2]`, with counts `[3, 2]`. The group region mean is `1.5`
across P1 and P3. Averaging the group map over this region would produce `2`,
which answers a different question. Both the numerical API and UI must preserve
this distinction.

## 6. Module and ownership design

```text
Producer arrays / validated evidence manifest
                    |
             SurfaceEvidence
       validation + paired reductions
                    |
          SurfaceEvidenceBinding
             /               \
   ordinary DataLayer     optional control capability
             |               |
   existing compositor   existing target -> session -> controls

InspectionSelection / ParcelSurface / VertexROI -> region queries
Portable scene codecs + evidence section        -> saved replay
```

Proposed files describe responsibilities; split helpers only when the
implementation warrants it.

| Location | Responsibility |
| --- | --- |
| `src/evidence/types.ts` | Input identities, domains, contrast specifications, numeric result types, and validation failures. |
| `src/evidence/SurfaceEvidence.ts` | Owned input storage and a small public API for evaluating a contrast and summarizing a region. No DOM, Three.js, or viewer imports. |
| `src/evidence/reductions.ts` | Internal paired arithmetic, deterministic accumulation, validity, and coverage calculations. |
| `src/evidence/SurfaceEvidenceBinding.ts` | Bind one dataset/contrast to explicit surface and output-layer addresses; follow inspection; commit derived maps; own cancellation and result caches. |
| `src/evidence/EvidenceManifest.ts` | Versioned evidence schema and structural validation. Reuse existing binary descriptor types. |
| `src/controls/EvidenceControls.ts` | Small JSON-like descriptors and the optional evidence command/query contract. No raw arrays or concrete viewer types. |
| `src/controls-ui/EvidenceSection.ts` | Internal evidence UI rendered by the existing controls element, using its styles and accessibility conventions. |
| `src/report/EvidenceReport.ts` | Evidence report assembly, hydration, and export through the existing report runtime. |

Keep internal reduction, cache, and hydration helpers out of the public barrel.
Export the public data, binding, and descriptor APIs consistently with current
repository conventions. The control and React artifacts must continue sharing
the core implementation rather than bundling a second copy.

An integration sketch shows the intended amount of host code. All names below
are proposed; this is not yet a runnable example. `domains`, `participants`, and
`observations` are host-supplied inputs described in section 5, and the two output
layers have already been added through the ordinary surface API.

```ts
import { SurfaceEvidence, bindSurfaceEvidence } from 'surfview';
import { mountSurfViewControls } from 'surfview/controls';

const evidence = new SurfaceEvidence({
  id: 'paired-study',
  quantity: { id: 'effect', units: 'percent signal change' },
  domains,
  participants,
  conditions: ['A', 'B'],
  observations
});

const binding = bindSurfaceEvidence(viewer, evidence, {
  contrast: { id: 'A-minus-B', minuend: 'A', subtrahend: 'B' },
  outputs: [
    { domainId: 'template-left', surfaceId: 'left', layerId: 'paired-effect' },
    { domainId: 'template-right', surfaceId: 'right', layerId: 'paired-effect' }
  ],
  regionWeighting: { kind: 'vertex' }
});
await binding.ready;

const controls = mountSurfViewControls(viewer, controlsHost, {
  target: { evidence: binding }
});
```

The pure `evaluateContrast()` and `summarizeRegion()` operations are also usable
without a viewer or controls. They return values, eligibility/count information,
and the resolved derivation specification. Invalid input fails with a typed
evidence error; asynchronous cancellation is distinct from a result with no
eligible observations. Control adapters translate these outcomes into plain
descriptors and evidence-specific command/query results.

### 6.1 Binding and layer ownership

The host creates or explicitly assigns an output `DataLayer` on each domain.
Creating a binding validates every address and domain before changing data.
One binding has one scalar-data writer per output layer; conflicting bindings
are rejected. No automatic layer-name inference or replacement is allowed.

While attached, the binding owns writes to those scalar buffers. Ordinary
controls still own appearance changes through the existing methods. Public
`setData()` calls from elsewhere invalidate the association and must be surfaced
as a conflict. Direct mutation through an existing mutable `getData()` reference
is outside this ownership contract; it must not be claimed to be detectable by
revision tracking. Export compares the committed output with the binding's
result before claiming a derivation matches the displayed map.

The binding owns its event subscriptions, pending jobs, scratch arrays, and
caches. It borrows geometry, surfaces, and host-created layers. Disposing it
stops computation and removes evidence capability; it does not dispose the
viewer or borrowed layers. The last committed map can remain as a static map
with a frozen derivation description. Viewer disposal cancels the binding.

The host owns the `SurfaceEvidence` instance and may share its immutable data
between bindings. Its explicit disposal releases its owned storage and cancels
dependent work; disposing one binding does not dispose the dataset. The normal
host teardown order is controls, binding, then dataset after its final consumer.

Removing or replacing a bound surface/layer invalidates the binding. It must
not attach itself to a later object merely because that object reuses an ID.
Dataset replacement is a validated, explicit operation that clears old caches.

### 6.2 Selection and ROI scope

`InspectionSelection` remains the one canonical vertex/parcel selection.
Hover, crosshairs, plot hover, and panel focus are presentation state.

The evidence query has a scope mode: follow the current inspection, or summarize
one named ROI. ROI scope refers to an existing `VertexROI` definition and its
membership revision. It does not add a synthetic `roi` member to the public
inspection union or pretend that an ROI is a representative vertex.

When an ROI is active, the UI labels it explicitly; cursor movement does not
change the region being summarized. **Follow selection** returns to ordinary
inspection. This scope is part of the saved query, whereas hover is not.

Use `FlatMapView` ROI events to update or invalidate active membership. A removed
ROI yields an unavailable result and clears its summary. A saved ROI contains
the actual membership snapshot, so replay does not depend on a later edit to
another application's ROI store.

Upgrade `LinkedBrainWorkspace` to use optional typed inspection getter/setter
methods where available. Mirror committed selection without re-emitting it in
the destination. Keep hover transient and retain crosshair-only compatibility
for lightweight viewer adapters. No bidirectional event loop is permitted.

### 6.3 Control integration

Add optional evidence descriptors to the canonical target snapshot and an
optional nested evidence command/query port to `SurfViewControlTarget`.
Third-party targets that omit it remain valid. Required base methods and the
existing `InspectionSelection` union do not grow solely for this feature.

The descriptors identify the bound dataset, contrast, output addresses, committed
participant selection, scope, display mode, result revision, and loading/failure
status. Observation rows are requested lazily for a particular revision; raw
typed arrays, layers, maps, and Three.js objects never cross the control port.

The binding is supplied explicitly in target options. Extend
`ControlTargetRegistry` to compare binding identity as well as current options:
two panels share the same binding; a conflicting request reports a conflict.
Do not add another global viewer registry. Explicitly supplied report targets
remain host-owned, as they are today.

Panel focus, disclosure, plot hover, and an uncommitted brush belong to
`ControlSession`. The applied participant set, display mode, and ROI scope belong
to the binding and are shared. Two panels can inspect different detail views
without silently changing each other's applied cohort.

Evidence state can change without a viewer mutation. Target snapshots therefore
need a monotonic adapter revision covering both sources. Preserve viewer revision
as a separate internal input; do not put evidence data into `ViewerState` merely
to manufacture a viewer event. Test this change against existing session and
report subscription semantics.

### 6.4 Asynchronous computation and consistent display

Every computation carries a dataset revision and request revision. A superseded
or disposed request cannot publish arrays, labels, counts, or control results.
Cancellation applies during computation, not only before it starts.

Keep the last committed map and its label visible while a new request is pending.
The UI may announce that another result is being calculated, but it cannot label
the old map with the new cohort. An error leaves the last committed result intact.

After all domains are computed and validated, update bound layer data and
presentation in one synchronous commit window. Gate control snapshot publication
using the mutation-boundary pattern already present in the report adapter. The
existing render scheduler coalesces the resulting invalidations. Evidence-facing
subscribers receive one consistent result revision across maps, plots, and counts;
low-level per-layer events retain their existing semantics.

Do not introduce a general viewer transaction framework for this feature.
Validate all ordinary update preconditions before commit. Existing event listeners
can still throw or dispose a target reentrantly during an update. In that case,
restore the previous arrays and presentation on still-owned live layers where
possible, mark the binding unavailable if restoration is incomplete, and never
publish the attempted revision as successful. Retain the previous result for
inspection; do not allow evidence export from a partially updated display.

## 7. UI design within the current controls

Extend the existing selection/inspection area with an Evidence subsection.
Extract its rendering into `EvidenceSection.ts` rather than expanding the main
controls element with another large block of independent state logic.

The initial view contains a labeled paired-observation plot, a compact summary,
and an accessible participant table. The table is also the keyboard alternative
to point selection and brushing. Use the existing Lit dependency and SVG/HTML;
a plotting framework is unnecessary for this bounded chart.

Always show the contrast direction, units, region or vertex identity, and valid
participant count. Region summaries additionally show weighting and coverage.
Retain excluded participants as rows with explicit reasons. The difference axis
includes a visible zero reference, and plot limits remain comparable while
switching the displayed participant/subset within a contrast.

Keep original-cohort reference markers visible when a subset is applied. Provide
an explicit reset action. Support no selection, no eligible pairs, loading,
cancelled request, incompatible region, detached layer, and disposed target
without leaving an unlabeled stale result on screen.

React continues to wrap the same custom element. It does not acquire its own
reduction code, chart implementation, or evidence lifecycle. Add a separate
`evidence` feature flag to the existing controls feature filter, without adding
a new top-level section ID solely for evidence. It renders only when capability
is supplied; ordinary viewers retain their current UI.

Reports continue using `ReportSceneControlTarget`. Its joins must incorporate
the committed evidence display description for bound layers, rather than
overwriting it with a stale initial manifest label. The report still has one
displayed logical map across its explicitly registered hemispheres.

## 8. Portable evidence reports

Add an optional `evidence` section to the portable `SurfViewSceneManifest`, with
its own schema identifier, provisionally `surfview.evidence.v1`. Keep the ordinary
scene valid and self-describing without that section: it contains the baked
committed scalar map and its correct label, units, range, and threshold.

The evidence section records:

- Dataset, participant, condition, and domain identities; input provenance and
  explicit correspondence claims.
- Observation assets and shapes, reusing `SceneAssetDescriptor` and the existing
  Float32/Uint32 little-endian codecs and SHA-256 verification.
- Fixed masks, supplied area weights, and optional atlas metadata/labels using
  `ParcelData`. ROI definitions use the existing `VertexROI` structure with
  membership stored as an index asset when appropriate.
- The A-minus-B derivation, reduction version, participant order, missingness
  and coverage policies, and spatial weighting.
- The committed query, participant IDs, display mode, scope, saved inspection,
  and optional ordinary `ViewerStateV2` for exact supported view restoration.
- Runtime/build identity, source asset hashes, and the committed result's asset
  references. Free-text provenance supplements these fields; it cannot replace
  their typed meanings.

Keep observation assets in the evidence section's asset collection, not the base
scene's eagerly loaded asset collection. Current `SceneMount.loadAssets()` loads
all base assets. Opening a conventional report must not decode an entire study
merely because an evidence section exists.

Evidence activation is explicit in mount options. Validate known evidence schema
and reference structure before fetching its assets or creating feature resources.
When active, load required spatial assets with bounded concurrency, construct
`ParcelSurface` where atlas information is supplied, then create the binding and
report target. Reuse current report styling and bilateral registration. This
hydration helper creates existing domain types; it does not create a second atlas
or ROI model.

Restore saved query and view state only after their referenced surfaces, layers,
and regions exist. When evidence is enabled, the mount's existing `ready` promise
resolves after the initial evidence result and saved state are committed. In
ordinary scalar-only mode it retains its existing scope. Failure and disposal
must reject/cancel the evidence-enabled initialization and release its partial
resources through the same mount lifecycle.

An unknown evidence version can still accompany a usable baked scalar scene.
Explicit scalar-only mode may display that scene and report that evidence is
unavailable. Evidence-enabled mounting rejects the unsupported version before
evidence activation; it must not silently promise replay.

Provide a bounded self-contained HTML export with the matching built runtime,
controls assets, and selected dataset assets embedded. Export assembly must
receive those build assets explicitly or use repository tooling; it cannot fetch
a CDN or locate a matching runtime by guessing. Large bundles can use adjacent
verified assets and require a local/static HTTP server. Only the self-contained
mode promises reopening without a server or network connection.

The export action captures one committed revision. If another result is pending,
save the committed revision explicitly or wait for the requested result; never
combine one revision's map with another revision's query. Recheck the output
against the recorded derivation before writing an evidence report.

Input asset bytes, identities, and saved selections must survive round-trip
exactly. Independently recomputed numerical results must agree under documented
Float64/Float32 tolerances; do not promise identical framebuffer pixels across
GPUs. Existing PNG/SVG export remains a visual snapshot. The evidence report is
the artifact that preserves further interaction.

## 9. Performance and lifecycle qualification

Measure data ingestion, first contrast, repeated vertex and region queries,
subset changes, map commit/render, export, and disposal separately. Start these
measurements with the reduction implementation, before building the final UI.

The reference workload is 50 participants, two conditions, and two 32,492-vertex
hemispheres. Observation storage alone is 25,993,600 bytes, approximately
24.8 MiB. Account separately for input copies, scratch buffers, rendered maps,
decoded assets, encoded HTML/base64 strings, and GPU resources.

Provisional engineering targets, to be measured on a named runner and then
checked in as regression budgets:

- Cached vertex/parcel detail becomes usable within 100 ms at the 95th percentile.
- A resident-data participant-subset map change completes within 250 ms at the
  95th percentile, including the committed frame.
- Computation yields often enough to avoid evidence-caused main-thread tasks
  longer than 50 ms. Chunk work in an order that preserves deterministic sums.
- Retained evidence numeric storage, excluding caller-owned input and renderer
  storage, stays below twice the decoded observation payload plus 8 MiB for the
  reference workload. Measure export peak separately.
- Picking, recoloring, and appearance controls do not copy the full observation
  collection. Queries and output caches have explicit bounded ownership.
- A settled viewer has no recurring evidence work or render loop. After disposal,
  no pending callback publishes a result and all evidence-owned memory is releasable.

These are acceptance targets, not measured claims. Use the project's benchmark
method and bundle checks. If chunked main-thread work cannot meet responsiveness,
move the same private reduction engine into a worker and repeat numerical and
ownership checks. A public worker/provider abstraction is not a prerequisite.

## 10. Verification tied to failure modes

The computational-test design here follows the paired and regional estimands,
not snapshots of the implementation's output.

| Contract or failure | Required evidence |
| --- | --- |
| Participant pairing and contrast direction | Hand-computable fixtures with shuffled observation order, missing conditions, repeated IDs, and asymmetric A/B values; swapping A and B negates eligible differences. |
| Group means and denominators | An independently written R or Python oracle operating on the same serialized input values, including zero, missing, all-missing, and one-participant cases. |
| ROI semantics | The unequal-weight example in section 5, a representative vertex unlike the parcel mean, missingness causing a different result from a spatially averaged group map, and a missing tiny positive weight whose coverage ratio rounds to 1. |
| Invariance to presentation | Changing opacity, display thresholds, color limits, camera, and an admitted mesh variant leaves evidence values, membership, and eligibility unchanged. |
| Identity and domains | Mismatched hemisphere, quantity, units, domain, atlas, and out-of-range ROI membership fail before layer mutation. Reused surface IDs cannot revive stale bindings. |
| Precision | Adversarial cancellation and large finite Float32 inputs; compare with a higher-precision oracle where ordinary double arithmetic is insufficient as an oracle. Define absolute-plus-relative tolerances by scale and reduction length. |
| Selection consistency | 3D and flatmap picks update the canonical selection once; parcel summaries use full membership; ROI scope remains stable during hover and clears on removal. |
| Asynchronous consistency | Deliberately delayed and reordered jobs; only the latest valid request commits, and map, title, count, and plot carry the same committed revision. Test cancellation during work, disposal during loading, and a throwing or disposing listener midway through a bilateral commit. |
| Control compatibility | Existing third-party targets compile without evidence; two panels share applied state while retaining independent focus/brush previews; report and React adapters preserve these rules. |
| Portability | Export, reopen in a fresh browser context with network disabled, and compare input hashes, query, region, participant rows, counts, and map values. Exercise ordinary scalar-only mounting and both existing scene object shapes. |
| Rendered behavior | Actual framebuffer/picking checks on a cortical fixture, with inspected screenshots of normal, missing, loading, subset, individual, and reopened-report states. DOM text alone is insufficient. |
| Lifecycle and resource cost | Repeated mount/query/export/dispose; measure retained buffers, completed work, responsiveness, and unchanged-viewer costs using the existing performance harness. |

Use a small analytic fixture for normal CI and one distributable, genuinely
multi-participant dataset for end-to-end acceptance. Synthetic observations on a
real cortical mesh are useful engineering fixtures, but must be labeled synthetic
and do not satisfy the real-study demonstration criterion. Select the real data
and record its acquisition/export recipe, provenance, and redistribution terms
in the first implementation milestone. Data availability need not block the
pure contracts, but it remains a release requirement for the promised workflow.

Run normal repository gates on the eventual candidate: unit tests, strict source
and demo types, public type contracts, packed consumers, lint, build/size,
documentation examples, demo/docs builds, and relevant browser/performance gates.
Use [the current CI policy](../testing/ci-policy.md), not the obsolete
test counts or size ceilings in older planning documents.

Browser verification must use the project-installed Playwright browser. Run the
repository-required browser ownership audit before and after automation; close
only pages, processes, and tooling owned by that test session. Hosted checks must
complete on the eventual candidate revision before making a release claim.

## 11. Delivery milestones and dependencies

Each milestone should be a coherent reviewable change. This table is a delivery
sequence, not an instruction to publish commits or start parallel agents.

| Milestone | Work | Depends on | Exit criterion |
| --- | --- | --- | --- |
| M0: Characterize seams and establish fixtures | Freeze the input/estimand examples; select the real study; characterize current selection, report formats, label joins, and control revisions. Record initial bundle/performance baselines. | None | A reviewer can trace one participant's two input values through the exact proposed vertex and ROI calculations, and the source-integration assumptions are executable. |
| M1: Evidence data and arithmetic | Implement the bounded data model, domain checks, paired reductions, ROI weighting/coverage, and initial timing/memory probes. | M0 | Independent numerical and analytic fixtures pass; direct caller mutations cannot alter ingested evidence. |
| M2: Binding and canonical control capability | Bind ordinary output layers; repair optional canonical flatmap linking; add evidence descriptors/commands, revision handling, cancellation, and disposal. | M1 | A headless host and two control sessions drive the same result without a new layer type or duplicated selection state. |
| M3: Existing-controls workflow | Add the Evidence subsection, paired plot/table, participant inspection, explicit subset application, ROI scope, and all empty/loading/error states. Register one demo scenario. | M2 | Keyboard and pointer workflows agree, React uses the same implementation, and inspected rendered artifacts show consistent maps and explanations. |
| M4: Portable replay | Implement the versioned evidence section, separate asset loading, parcel/ROI hydration, report-aware binding, and self-contained export. | M1 and M2; integrate with M3 | A saved real-study report reopens offline in a fresh context and reproduces inputs, selected contributors, region summaries, and displayed map. |
| M5: Qualification and documentation | Complete measured budgets, adversarial and lifecycle checks, packed-consumer/type evidence, guide/API/demo documentation, and release-candidate gates. | M3 and M4 | The full first-release acceptance workflow passes, with measured limits and any unsupported cases documented. |

Do not treat M3's attractive demo as completion while M4's replay or M5's
scientific/lifecycle evidence is pending. The useful first deliverable within
implementation is M1 plus M2: a small, independently verified API that existing
hosts can exercise without adopting the first-party panel.

## 12. Documentation and change scope

The implementation should add a guide centered on the paired-participant
workflow, with one canonical runnable example that is checked against the packed
package. Update guide navigation, controls and portable-scene guides, API exports,
the responsibility map, and the demo manifest when those features exist.

Document the input producer's responsibilities alongside the example: explicit
correspondence, quantity/units, one estimate per participant and condition,
analysis mask, and any anatomical area weights. Document all result denominators
and the distinction between per-vertex map means and eligible-participant ROI
means where those summaries first appear.

The current checkout contains substantial unrelated work. Implementation should
re-read the touched files, preserve that work, and validate coherent changes
against a recorded candidate. Planning does not authorize publication, a package
release, or changes to downstream repositories.

## 13. Follow-on additions after the first release

Later work can add explicitly indexed analysis variants, trial/time dimensions,
upstream uncertainty summaries with their methods, or lazy data providers. Each
must reuse the evidence model, output layers, selection, controls, and report
format already qualified here.

Analysis variants must remain distinct from independent participants. Temporal
support can reuse playback once its sampling and interpolation semantics are
defined; participant IDs must never be represented as interpolated time frames.
Relaxed ROI coverage must expose its changed support and estimand. Large-study
providers must preserve revision identity and cancellation across partial loads.

These additions are deferred explicitly. None is required to demonstrate the
first complete paired-participant evidence report.
