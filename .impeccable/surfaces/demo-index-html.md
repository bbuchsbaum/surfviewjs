---
version: 1
slug: "demo-index-html"
primary_target: "demo/index.html"
related_targets: ["demo/puzzle.html","demo/map-lab.html"]
---

# Demo gallery surface brief

Scope: the SurfView demo gallery (`demo/index.html` shell and its chapter scenarios; `demo/puzzle.html`, `demo/map-lab.html` inherit the world). Visitor mode: Experience with Operate panels — the rendered cortex leads; controls must stay fully operable.

Audience and job: developers evaluating surfview (see the capability and copy the public-API excerpt) and researchers (put maps on a cortex, threshold, inspect, export a figure). Constraints: 13 chapters on real fsaverage5 / fs_LR meshes; synthetic maps labelled synthetic; collapsible type-checked code excerpt per chapter; e2e specs updated alongside; QA fixtures move to `tests/`.

## Direction contract

THESIS: Each capability is hung as one film on a backlit viewbox in a dim reading room, its live state printed in the film's corners like a scan overlay. Refuses the category default of sidebar + boxed dark panels + cyan accent dashboard.

OWN-WORLD: Blue-tinted film base (#0b1118 → #1c2732) on an unlit room; the viewbox's daylight white (#e9f0f4) appears only as the lit gaps and edges between sheets; corner overlays and edge printing in a data mono; labels in a condensed grotesk; chinagraph yellow (#f2c230) reserved for user marks and the active control, chinagraph red (#d6452e) for errors. One exposure scale D0–D3 maps every element's prominence. No cards, no rounded boxes; sheets are rectangles with film-edge markings.

STORY: A visitor sees a real brain under a scan-style overlay, reads what the chapter demonstrates, operates window/level-style controls whose values print into the film corners, opens the code excerpt to copy, and moves along the chapter strip like flipping films on the box.

FIRST VIEWPORT: Top: a single-row chapter strip of small film frames (title + one-word subject), the active one lit. Below: one large film sheet (≈70% width) holding the viewer, with four corner overlays (chapter/surface, layers, window/level, cursor/vertex) and L R S I orientation letters at its edges; right: a narrow unlit margin with the chapter's one-paragraph note, its controls set as margin readouts, and the collapsed code excerpt. Signature interaction: changing a control prints its value into the film corner as it moves; one shared motion clock drives transitions.

FORM: Radiology film on a reading-room lightbox — candidate 7 of 7 on the grounded list. Seed key b2e0f614. Raises: one exposure scale (cracktro), one motion clock (drum machine), chinagraph yellow reserved for user marks (punk paste-up), one subject per sheet (ikebana), registered pairs where geometry changes (curved crease).

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## Unresolved

- Exact chapter copy per scenario is written during build from the library's real behaviour.
