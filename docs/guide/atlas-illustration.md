# Illustrated atlas plates

Atlas plates show parcel colors, boundaries, and region names together on a white
background. Recolor a region, show a value map, or select a parcel without moving
its label. Choose **Atlas illustration** in the demo gallery (or open it with
`?scenario=atlas-illustration`) to explore Glasser HCP-MMP1.0 or Schaefer–Yeo 400
in left lateral and medial views. Schaefer offers both 7- and 17-network versions.

`buildAtlasPlate` produces geometry and label positions. `AtlasPlateView` displays
that result as interactive SVG. Both are named exports from `surfview`.

## Create a plate from a parcel surface

Start with a `ParcelSurface` containing an inflated mesh, matching vertex labels,
and parcel metadata. The mesh must use RAS coordinates: positive X is right,
positive Y is anterior, and positive Z is superior. Use the hemisphere recorded
by the source data. An equal vertex count alone does not establish that labels
and geometry use the same registration or vertex ordering.

```ts
import { buildAtlasPlate, AtlasPlateView } from 'surfview';
import type { ParcelSurface } from 'surfview';

declare const surface: ParcelSurface; // Your loaded left-hemisphere parcel surface.
declare const container: HTMLElement; // An application-owned element.

const plate = buildAtlasPlate({
  vertices: surface.geometry.vertices,
  faces: surface.geometry.faces,
  vertexLabels: surface.getVertexLabels(),
  parcelData: surface.getParcelData(),
  hemisphere: 'left'
}, {
  view: 'medial',
  width: 1000,
  height: 740,
  fontSize: 15,
  contourSmoothing: 4
});

const illustration = new AtlasPlateView(container, plate, {
  colors: new Map([[1, '#ed861d'], [4, '#f4bd87']]),
  onParcelClick: parcelId => console.log('Selected parcel:', parcelId)
});

// Change fills independently of the geometry and label layout.
illustration.setColors(new Map([[1, '#18394f'], [4, '#f4bd87']]));
illustration.setSelection(1);
illustration.setLabelsVisible(true);

// On application teardown:
// illustration.dispose();
```

Colors accept `#RGB` or `#RRGGBB`. Omitted IDs use the neutral `defaultColor`.
Dark fills receive light text; light fills receive dark text. The text halo uses
the underlying region color. `setColors` replaces the color map; callers mapping
ROI values through `ColorMap` should prepare a complete map of parcel IDs to hex
colors. Atlas ID 0 is reserved for background and medial wall, and is omitted
from the parcel table. Parcel metadata IDs must be unique positive integers.

Clicks on either a filled region or its name select the parcel. Region paths are
also keyboard focusable and respond to Enter/Space. `setSelection` does not emit
the click callback, so an application can synchronize several plates or connect
the callback to `viewer.setParcelSelection(surfaceId, parcelId)` without a loop.

## Boundary hierarchy and color

The default style uses fine solid parcel boundaries, a stronger outer contour,
and no white bands. This keeps thin projected parcels visible without giving
every border equal visual weight. The demo's **Boundary style** selector also
offers fine dashed lines and the earlier dashed-with-white-bands treatment.

Pass `parcelGroups: Map<parcelId, string>` to `buildAtlasPlate` to identify networks
or another meaningful grouping. Interfaces between two different, explicitly
assigned groups receive stronger strokes. Unassigned parcels keep ordinary
boundaries. Grouping never merges parcels or derives identity from their colors;
changing a fill or displaying a value map leaves network membership unchanged.
Group names are retained on regions and in exported SVG metadata.

```ts
// Given the illustration created above:
illustration.setStyle({
  boundaryColor: '#514c47',
  boundaryWidth: 0.65,
  boundaryOpacity: 0.55,
  boundaryHaloWidth: 0,
  groupBoundaryWidth: 1.15, // 0 hides group emphasis.
  outlineWidth: 1.65,
  dashed: false
});
```

These are the defaults; widths are in SVG units. `setStyle` merges appearance
settings without rebuilding geometry, moving labels, or replacing current colors
unless a new `colors` map is supplied. The same options work in the constructor
and `renderAtlasPlateSVG`. Set `boundaryHaloWidth: 4.2` and `dashed: true` for
white bands with dashed center lines.

Schaefer demos start with a muted network palette and a color key above the
plates. Both the 7- and 17-network assignments use the source label table.
**Original atlas colors** restores the upstream color table. Palette changes
affect presentation only; custom ROI colors and synthetic value maps remain
available. The color key describes the default network fills and flags custom
overrides; individual plate exports contain the plate and its metadata.

## Readable labels

Label placement uses the visible footprint of each region. Text fits inside its
parcel where possible; narrow regions receive margin callouts. The layout is
deterministic and independent of colors and selection. It stays fixed when the
SVG is resized, preserving the composition; enlarging a plate also enlarges text.

The default `fontSize` is 14 SVG units. For exact browser font measurements, pass
`measureText(text, fontSize)` using a canvas configured with
`${fontSize}px Arial`. Without that callback, the builder uses a conservative
width estimate. The SVG uses Arial with Helvetica/sans-serif fallbacks.

`labelText(parcel)` controls the text drawn on the plate without replacing the
canonical parcel name or ID. For long Schaefer names, `labelText: p => String(p.id)`
produces compact numeric labels. The full name remains in the SVG's region titles,
accessible region names, and label hover titles. The demo also lists every parcel
by ID and full name. Colors and selection always use IDs, never the display text.

`labelPositions` accepts a `Map<parcelId, { x, y }>` for saved, view-specific
adjustments. These change text positions while retaining anchors on the visible
parcel. Clipped or overlapping saved labels are rejected. Labels too small to
fit are reported in `plate.unlabeledParcelIds`; they are not silently presented
as labeled. `minLabelArea` defaults to 12 square SVG units and can be set to 0
to attempt labels for every visible fragment. Margin capacity can still limit
how many labels fit. Fills are never removed by this setting.

`maxLeaderLength` limits callouts to 120 SVG units by default. The demo uses 90
for a quieter composition. Increase it to attempt more names; the demo exposes
this as **All visible · extended callouts**. `calloutGap` controls the minimum
space between margin labels (default 16; the balanced demo uses 20). Callouts
retain anchor order and share displacement across crowded clusters, rather than
packing every name to one side. If a margin is full, larger visible parcels take
priority, and unplaced names remain in `unlabeledParcelIds`.
Use `illustration.setPlate(replacement)` to display a rebuilt label layout while
retaining the current colors and selection. Label pins also survive when the
replacement has the same projected label domain; a different domain resets pins
and inspection framing.

`plate.hiddenParcelIds` lists parcels with no visible samples in the selected
view. An application can expose all names in a region list, as the demo does.
Hidden parcels remain selectable but do not acquire labels through the surface.

## Compose a figure

The demo's **Figure** controls arrange lateral and medial panels vertically or
side by side, edit the title, and export both panels with a shared network key in
one SVG. **Move & pin labels** enables dragging. Focus a label and use arrow keys
to move it by one plate unit (Shift moves ten; steps adjust with zoom); Escape
unpins it. Moving a label creates a leader to its original visible parcel anchor.
Pins take priority over automatic labels, which can yield space. Two pins cannot
overlap, and a pin cannot clip the plate edge. **Reset label pins** restores the
automatic layout.

`AtlasPlateView` exposes the same behavior without the demo controls:

```ts
// Given the illustration created above:
illustration.setLabelEditing(true);
const pins = illustration.getLayout();
// Persist pins using JSON.stringify(pins). Restore against the matching plate:
illustration.setLayout(pins);
// Programmatic adjustment, in plate coordinates:
illustration.setLabelPosition(1, { x: 400, y: 100 });
illustration.setLabelPosition(1, null); // Unpin this label.
```

`onLayoutChange(layout)` reports completed user edits; programmatic setters do
not emit it. `onInteractionError(error)` reports a rejected drag or keyboard move.
`getLayout()` returns an independent copy. Saved positions are validated against
the atlas identity, hemisphere, projection, dimensions, sampling resolution,
parcel names, and projected label footprint. Changing smoothing or colors keeps
them compatible. Changing label text can make a pin too wide; an incompatible
replacement is rejected before changing that view. The demo asks you to reset
pins before making such a text change.

For a complete figure, use a versioned `AtlasFigureSpec`. It stores panel order,
titles, column count, label pins, and a categorical legend. Supply the current
plates and colors separately, so new ROI values can use the same composition:

```ts
import { renderAtlasFigureSVG, parseAtlasFigureSpec } from 'surfview';
import type { AtlasFigureSpec, AtlasFigureSource, AtlasPlateView, AtlasPlate } from 'surfview';

declare const lateral: AtlasPlate;
declare const medial: AtlasPlate;
declare const lateralView: AtlasPlateView;
declare const medialView: AtlasPlateView;

const sources = new Map<string, AtlasFigureSource>([
  ['left-lateral', { plate: lateral, style: lateralView.getStyle() }],
  ['left-medial', { plate: medial, style: medialView.getStyle() }]
]);
const figure: AtlasFigureSpec = {
  version: 1,
  title: 'Cortical atlas',
  subtitle: 'Left hemisphere · inflated surface',
  columns: 2,
  panels: [
    { key: 'left-lateral', title: 'Lateral', layout: lateralView.getLayout() },
    { key: 'left-medial', title: 'Medial', layout: medialView.getLayout() }
  ],
  legend: [] // Add { label, color } entries matching your categorical fills.
};
const saved = JSON.stringify(figure);
const restored = parseAtlasFigureSpec(JSON.parse(saved), sources);
const figureSVG = renderAtlasFigureSVG(restored, sources);
```

Complete figure exports always use the overview framing and saved pins, with
selection emphasis removed. Each nested plate retains its provenance metadata.
The renderer accepts 1–16 panels and one or two columns; panel dimensions determine
the output dimensions. It does not infer legend meanings from colors or data.
For a DOM-free composition, use `emptyAtlasLayout(plate)` in place of a mounted
view's `getLayout()` result.
Keep a value-map colorbar in the application when displaying continuous values.

The demo's **Save layout / Load layout** controls store and restore the two panel
composition and pins as JSON. Loading leaves current fills, border settings,
label text, and the live legend under the current controls; it is not a data or
mesh archive. Every panel is checked before any changes are applied. Switching
between Schaefer network versions requires its own matching layout.

## Reveal detail with attention

Pass `detailScales: [2, 4, 8]` to `buildAtlasPlate` to prepare denser interior
label layouts while the visibility buffer is available. These optional layouts
add computation during building but require no surface reprojection during zoom.
They use the same `labelText` function as the overview. Full source names remain
in hover titles and in the demo's region detail heading.

Use `illustration.setZoom(2, { x: 500, y: 370 })` to inspect a position, or
`illustration.focusParcel(id)` to frame a visible parcel's footprint. The latter
returns `false` for parcels hidden in that projection. `setZoom(1)` restores the
overview. The mounted view supports dragging to pan when zoomed, clamps inspection
to the plate, and limits magnification to 8×. `getViewport()` returns zoom and
center; `onViewportChange(viewport)` reports framing changes.

As the view magnifies, labels come from the densest prepared layout that fits.
Only complete labels within the crop are drawn. In a narrow panel,
`minInspectionFontSize` (default 12 CSS pixels) targets readable text by reducing
density; enlargement is capped by the current zoom so labels still fit their
source footprints. Set it to 0 to disable this size adjustment. Boundary and
selection strokes retain their weight during zoom. `setAdaptiveLabels(false)`
keeps the overview candidates during inspection.

The demo's **Inspect selected region** opens a magnified detail panel using the
projection with the largest visible footprint. The selected parcel stays marked
on both full plates, preserving context. Closing the detail panel releases its
view. This inset is for inspection; it is not included in the composed figure.

Magnification changes framing and label density. It cannot recover hidden regions
or features lost at the original sampling resolution, and it does not make
smoothed contours more anatomically precise.

## Export the displayed style

```ts
// Given the illustration created above:
const svgText = illustration.toSVG();
const overviewSVG = illustration.toSVG({ overview: true }); // Saved framing, even while inspecting.
const svgBlob = new Blob([svgText], { type: 'image/svg+xml;charset=utf-8' });
const pngBlob = await illustration.exportPNG(3); // 3x width and height.
```

The SVG contains editable compound paths and text, with no embedded images or
scripts. Its metadata records the atlas ID, hemisphere, view, sampling resolution,
and unlabeled/hidden parcel IDs. Optional input `provenance` (`source`, `citation`,
`license`, `checksum`) is retained in SVG metadata; the Glasser demo includes it.
PNG export rasterizes this same SVG, retaining
its colors, labels, and selection. Download the blobs using the application's
normal download workflow. `renderAtlasPlateSVG(plate, style)` also generates SVG
text without mounting a browser view.

`displayedLabelIds` records the exported labels. `unlabeledParcelIds` includes all
parcels visible in the source projection but unlabeled in that export, including
those outside an inspection crop. `overviewUnlabeledParcelIds` retains omissions
from the original automatic layout, before pins and inspection.

## Geometry and current scope

This first version supports fixed lateral and medial views of either hemisphere.
It uses the supplied geometry without deforming it. It does not reproduce the
hand-adjusted outlines or expanded cortical regions in a published illustration.
The demo's peach/orange highlights are illustrative choices, and its value-map
mode uses explicitly synthetic values.

Visibility is computed with an orthographic depth buffer, including zero-labeled
medial-wall triangles as occluders. Inside a triangle, the label of the largest
barycentric coordinate determines categorical ownership. This is an explicit
interpolation convention, not an inferred histological boundary.

The builder traces shared interfaces from that visibility buffer and reuses each
interface for both adjacent fills and the boundary stroke. Holes, islands, and
junctions remain represented in the SVG. Paths approximate the mesh projection
at `resolution` samples per SVG unit (default 2), with contour simplification
limited to 0.4 sampling pixels. SVG magnification does not recover features lost
at the original sampling resolution; rebuild at a higher resolution when needed.
The visibility buffer is limited to eight million samples, and PNG export to
32 million pixels.

For a softer illustrated border, `contourSmoothing` enables Gaussian smoothing
of each shared arc followed by tangent-continuous quadratic corner rounding.
Both neighboring fills and the stroke reuse the same curve, in opposite
directions where necessary. Shared junction endpoints stay fixed; very short
arcs receive less smoothing to limit erosion of tiny components.

The setting is in SVG units (0–8, default 0; the demo uses 4). It bounds the
displayed curve's distance from its sampled interface by that amount plus
`0.4 / resolution` for simplification, before SVG coordinate rounding. Higher
sampling resolution reduces pixel steps; smoothing softens the larger sawtooth
introduced by discrete mesh labels. They control different approximations.

Use the demo's **Border smoothing** slider to compare them. Zero retains sampled
polylines; 2 is light smoothing, 4 is the demo's illustrated setting, and 8 is
stronger. Smoothing is a presentation adjustment, recorded in SVG metadata.
It does not edit vertex labels or measured `visibleArea`. It can change thin
features and apparent area; use 0 for inspecting sampled boundaries. Label layout
uses the original visibility buffer and stays fixed when smoothing changes.

Plates are snapshots. Rebuild after changing mesh geometry, vertex labels, view,
or automatic label layout; recoloring, selection, label pins, and inspection only
update presentation. Freely rotating illustration views, superior/basal plates,
curved text, and arbitrary panel positioning are outside this implementation.
Always dispose mounted views
when their application panels are removed.

## Reuse with Schaefer–Yeo or another atlas

The builder contains no Glasser-specific region names, colors, or topology.
Provide a mesh, one categorical label per vertex, and a `ParcelData` table.
The same call works for Schaefer, another surface atlas, or a custom parcellation:

```ts
import { buildAtlasPlate } from 'surfview';
import type { AtlasPlateInput } from 'surfview';

declare const schaeferInput: AtlasPlateInput; // Matching fsLR geometry and labels.
const schaeferPlate = buildAtlasPlate(schaeferInput, {
  view: 'lateral',
  width: 1200,
  height: 850,
  resolution: 2,
  contourSmoothing: 4,
  fontSize: 14,
  labelText: parcel => String(parcel.id)
});
```

The bundled example uses the authors' [CBIG fsLR 32k CIFTI files](https://github.com/ThomasYeoLab/CBIG/tree/master/stable_projects/brain_parcellation/Schaefer2018_LocalGlobal/Parcellations/HCP/fslr32k/cifti),
converted offline using their explicit BrainModel vertex mapping. Schaefer 400
means 400 parcels across both hemispheres; these left-hemisphere plates contain
200. Choose **Schaefer–Yeo 400 · 7 networks** or **17 networks** in the demo, or
append `&atlas=schaefer400-7` / `&atlas=schaefer400-17` to the scenario URL.

Source IDs, full names, original colors, medial-wall zeros, citations, and source
checksums are retained. The two network versions can order parcels differently:
the demo clears selection and custom colors when switching datasets. Applications
should key saved values by atlas identity and parcel ID. Use the hemisphere too
when an atlas reuses IDs between hemispheres.

For another space, supply its matching geometry and labels. A volumetric MNI atlas
or fsaverage annotation cannot simply be assigned to an fsLR surface. The runtime
accepts decoded vertex arrays; the demo's conversion script is specific to its
pinned sources, not a general CIFTI loader.

| Setting | Controls |
| --- | --- |
| `contourSmoothing`, `resolution` | Border appearance and visibility sampling |
| `fontSize`, `labelText`, `measureText` | Label size, content, and font metrics |
| `padding`, `maxLeaderLength`, `calloutGap`, `minLabelArea` | Callout space and label density |
| `labelPositions` | Saved, view-specific placements |
| `detailScales` | Optional denser interior layouts for inspection |
| `getLayout`, `setLayout`, `setLabelPosition` | Portable, validated label pins |
| `setZoom`, `focusParcel`, `minInspectionFontSize` | Framing and text readability during inspection |
| `AtlasFigureSpec`, `renderAtlasFigureSVG` | Saved panel composition and complete vector export |
| `parcelGroups` | Explicit parcel-to-network or other group assignments |
| View `colors`, `dashed`, `labelsVisible`, boundary widths/opacity | Fills, border hierarchy, and label visibility |
