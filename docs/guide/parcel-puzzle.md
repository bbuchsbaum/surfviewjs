# Cortical parcel puzzle

Open the [Glasser parcel puzzle in the demonstration gallery](https://bbuchsbaum.github.io/surfviewjs/demo/?scenario=parcel-puzzle&atlas=glasser),
or use the [standalone puzzle](https://bbuchsbaum.github.io/surfviewjs/demo/puzzle.html?atlas=glasser).

For an experimental fitted 2D layout with adjustable geometric objectives, see
the [parcel map laboratory](./parcel-map-lab.md).

`ParcelPuzzleView` displays atlas parcels as separate curved shells. Hover lifts a
piece; selecting it brings it in front of the brain and opens a detail preview.
Drag the selected piece or the preview to rotate that piece independently. Its
translucent socket marks its resting location. **Return piece** or Escape restores
the original position and orientation.

The [standalone puzzle demo](https://bbuchsbaum.github.io/surfviewjs/demo/puzzle.html)
uses the real left-hemisphere Schaefer–Yeo 400 and Glasser HCP–MMP1.0 labels with
matching fsLR 32k inflated geometry. For local development, run `npm run demo` and
open `/puzzle.html`, or select **Glasser parcel puzzle** in the gallery's featured atlas tools.
`node scripts/build-parcel-puzzle-demo.mjs` also creates an offline, single-file
demo at `output/concepts/parcel-puzzle-demo.html`, including the sample geometry,
atlas labels, provenance and licenses.

## Mount a puzzle

Supply vertices, triangle indices, a label for every vertex, and a parcel table.
The surface and atlas must use the same vertex ordering and coordinate domain.
The library checks sizes and parcel IDs, but cannot infer anatomical registration
from those alone. Parcel IDs are keys, so table rows may be reordered freely.

```ts
import { ParcelPuzzleView } from 'surfview';
import type { ParcelData, SurfaceGeometry } from 'surfview';

function mountPuzzle(
  container: HTMLElement,
  surface: SurfaceGeometry,
  vertexLabels: Uint32Array,
  parcelData: ParcelData
) {
  const view = new ParcelPuzzleView(container, {
    vertices: surface.vertices,
    faces: surface.faces,
    vertexLabels,
    parcelData
  }, {
    thickness: 2,
    separation: 0.04,
    relief: 1,
    view: 'oblique'
  });

  view.on('selection:changed', ({ parcelId }) => {
    console.log('Selected parcel:', parcelId);
  });

  return () => view.dispose();
}
```

Give the container an explicit height, for example `height: 700px`. The view owns
its DOM, renderer, camera controls, generated shells and detail preview. Disposal
is idempotent and removes only the view's own content. Source arrays are never
modified. No styles or browser resources are allocated just by importing the API.

## Interaction and display controls

| API or option | Behavior |
| --- | --- |
| `selectParcel(id)` / `selectParcel(null)` | Pin a represented parcel or return the selection. |
| `setSeparation(0…1)` | Expand parcel centers about the mesh center. Zero reassembles the puzzle when relief is 1. A value of 0.1 expands center positions by 10%; it is not a uniform boundary gap in millimeters. |
| `setRelief(0.15…1)` | Compress each piece along its mean normal. One preserves its original curvature. This is a local display deformation, not a cortical flat-map projection. |
| `setView('lateral' \| 'medial' \| 'oblique')` | Reset the camera for a left hemisphere in RAS coordinates. For another orientation, use the exposed `viewer` camera/controls. |
| `hoverLift` | Hover displacement in mesh coordinate units. Defaults to 4% of the mesh's bounding-box radius. |
| `selectionLift` | Additional clearance beyond the front of the puzzle. Defaults to 12% of that radius. |
| `color(parcel)` | Supply each parcel's presentation color; otherwise use its `color` field or the default fill. |
| `labelText(parcel)` | Format display names while retaining the full source record. |
| `reducedMotion` | Skip transform easing. By default, follow the system preference. |
| `getParcelScreenPosition(id)` | Current piece center in client coordinates for application overlays. A centroid may lie outside an irregular piece. |

The parcel menu provides a keyboard and touch alternative to hover. Focus the
detail canvas and use arrow keys to rotate. Global camera dragging and dragging
the selected piece are separate interactions. Hover picking uses resting shells,
so a piece does not lose focus merely because lifting moves its surface away from
the pointer. A selected floating piece is also pickable at its displayed position.

## Application-specific details

`renderDetail` mounts content below the rotatable preview. It can use any DOM or
plotting library; the viewer does not prescribe a measurement schema. The callback
receives the original parcel record, geometry summary and an `AbortSignal`. Return
a cleanup function for mounted charts or application event listeners.

```ts
import type { ParcelDetailRenderer } from 'surfview';

const renderDetail: ParcelDetailRenderer = (container, { parcel, signal }) => {
  const description = document.createElement('p');
  description.textContent = `Loading measurements for ${parcel.label}…`;
  container.appendChild(description);

  void fetch(`/api/parcels/${encodeURIComponent(parcel.id)}`, { signal })
    .then(response => {
      if (!response.ok) throw new Error('Measurement request failed');
      return response.text();
    })
    .then(text => { if (!signal.aborted) description.textContent = text; })
    .catch(() => {
      if (!signal.aborted) description.textContent = 'Measurements unavailable';
    });

  return () => description.remove();
};
```

Pass this callback in the `ParcelPuzzleView` options. Changing selection,
dismissing the detail, or disposing the view aborts the old signal and runs its
cleanup. Callback exceptions show an unavailable message and emit `detail:error`.
No example measurements are generated by the library.

## Geometry and interpretation

The extraction interpolates one indicator per label across each source triangle
and assigns its interior to the largest indicator. Boundaries cross mixed-label
edges at their midpoint; three-label junctions meet at the triangle centroid.
Both neighboring pieces use the same boundary coordinates. Triangles with two
vertices of the same label give that label three quarters of their area; three
distinct labels each receive one third. This convention defines the displayed
boundary between discrete vertex labels.

Each resulting surface patch gets a backing offset inward along interpolated
mesh normals and side walls at its boundary. These form closed shells on a
consistently wound manifold input. The backing is **illustrative thickness**, not
measured cortical thickness or a segmentation of gray matter volume. Very thick
backings on tightly folded surfaces can intersect themselves or neighboring
pieces; use modest thickness, preferably with inflated geometry.

Label 0 is background by default and is omitted. Set `backgroundLabel` to use a
different sentinel. A parcel table may include parcels absent from the supplied
hemisphere: `view.puzzle.geometry.unrepresentedParcelIds` reports them, and they
cannot be selected. Disconnected components of one parcel remain under that
parcel's ID and move together. `surfaceArea` always describes the extracted
source top surface, before relief or separation; on an inflated mesh it is an
inflated-mesh area, not native cortical area.

For a custom renderer, `buildParcelPuzzle()` returns the generated geometry and
`ParcelPuzzle` supplies the scene group, picking and transform state without
creating a DOM or WebGL context. Call `update(elapsedSeconds, directionToCamera)`
while transitions are active; it returns whether another frame is needed. Call
`dispose()` when finished. Similarity-based rearrangement is a separate future
layout and is not part of this interaction.
