---
name: SurfView demo gallery
description: Capability chapters hung as films on a backlit viewbox in a dim reading room.
colors:
  room: "#06080b"
  box: "#dde6ec"
  box-ink: "#23303b"
  d0: "#0b1118"
  d1: "#0f1720"
  d2: "#16212b"
  d3: "#213040"
  ink-hi: "#edf2f5"
  ink: "#c3ced6"
  ink-lo: "#93a6b4"
  mark: "#f2c230"
  mark-ink: "#1a1405"
  alert: "#ec6a52"
  cortex: "#b7c0c8"
typography:
  display:
    fontFamily: "Archivo Variable, Archivo, system-ui, sans-serif"
    fontSize: "clamp(26px, 2.1vw, 34px)"
    fontWeight: 640
    lineHeight: 1.04
    letterSpacing: "-0.005em"
    fontVariation: "'wdth' 72"
  title:
    fontFamily: "Archivo Variable, Archivo, system-ui, sans-serif"
    fontSize: "19px"
    fontWeight: 700
    letterSpacing: "0.01em"
    fontVariation: "'wdth' 78"
  body:
    fontFamily: "Archivo Variable, Archivo, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.5
    fontVariation: "'wdth' 96"
  body-note:
    fontFamily: "Archivo Variable, Archivo, system-ui, sans-serif"
    fontSize: "14.5px"
    fontWeight: 400
    lineHeight: 1.55
  label:
    fontFamily: "Archivo Variable, Archivo, system-ui, sans-serif"
    fontSize: "13.5px"
    fontWeight: 520
    lineHeight: 1.2
    fontVariation: "'wdth' 84"
  label-section:
    fontFamily: "Archivo Variable, Archivo, system-ui, sans-serif"
    fontSize: "11.5px"
    fontWeight: 650
    letterSpacing: "0.12em"
    fontVariation: "'wdth' 78"
  data-corner:
    fontFamily: "JetBrains Mono Variable, JetBrains Mono, ui-monospace, monospace"
    fontSize: "11.5px"
    fontWeight: 400
    lineHeight: 1.35
    fontFeature: "'tnum'"
  data-edge:
    fontFamily: "JetBrains Mono Variable, JetBrains Mono, ui-monospace, monospace"
    fontSize: "10.5px"
    fontWeight: 400
    letterSpacing: "0.1em"
  data-code:
    fontFamily: "JetBrains Mono Variable, JetBrains Mono, ui-monospace, monospace"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.6
rounded:
  none: "0"
spacing:
  tight: "4px"
  seam: "6px"
  stack: "12px"
  margin-gap: "18px"
  margin-inset: "30px"
  gutter: "clamp(16px, 2.4vw, 40px)"
components:
  frame:
    backgroundColor: "{colors.d1}"
    textColor: "{colors.ink}"
    typography: "{typography.label}"
    rounded: "{rounded.none}"
    padding: "9px 12px 13px"
    height: "56px"
  frame-hover:
    backgroundColor: "{colors.d2}"
    textColor: "{colors.ink-hi}"
  frame-active:
    backgroundColor: "{colors.d3}"
    textColor: "{colors.ink-hi}"
  action:
    backgroundColor: "transparent"
    textColor: "{colors.ink-hi}"
    typography: "{typography.label}"
    rounded: "{rounded.none}"
    padding: "7px 13px 8px"
  action-hover:
    backgroundColor: "{colors.d2}"
  action-pressed:
    textColor: "{colors.mark}"
  action-primary:
    backgroundColor: "{colors.box}"
    textColor: "{colors.d0}"
    rounded: "{rounded.none}"
    padding: "7px 13px 8px"
  choice:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    rounded: "{rounded.none}"
    padding: "6px 10px"
  choice-checked:
    textColor: "{colors.mark}"
  select:
    backgroundColor: "{colors.d0}"
    textColor: "{colors.ink-hi}"
    rounded: "{rounded.none}"
    padding: "7px 30px 7px 10px"
  film:
    backgroundColor: "{colors.d0}"
    textColor: "{colors.ink-hi}"
    rounded: "{rounded.none}"
  film-corner-line:
    textColor: "{colors.ink-hi}"
    typography: "{typography.data-corner}"
  code-excerpt:
    backgroundColor: "{colors.d0}"
    textColor: "{colors.ink}"
    typography: "{typography.data-code}"
    padding: "14px 14px 16px"
---

# Design System: SurfView demo gallery

## Overview

**Creative North Star: "The Reading Room Lightbox"**

Every chapter is one radiology film hung on a backlit viewbox in an unlit room. The rendered cortex is the subject of the sheet; the sheet's live state (surface, layer, window, threshold, vertex under the cursor) is printed into its four corners in a data mono, the way a scanner prints its overlay. The lit viewbox never fills a panel: it shows only as the seams between sheets (the chapter strip, the 6px border around the film). Everything else sits in the dark room.

Prominence is one exposure scale. Four film densities (D0 to D3) carry every surface from film base to the lightest hung sheet, and hover and selection move an element one step brighter rather than adding color. Color proper is chinagraph pencil: yellow for what the user marked or is operating, red for errors. Controls live in the unlit margin to the right of the film as plain readouts separated by hairline rules, not as boxed panels.

The world rejects the category default of a sidebar, boxed dark panels, and a cyan accent dashboard. Corners are square, there are no shadows, and nothing floats.

**Key Characteristics:**
- One large film per chapter, ~70% width, with corner overlays and anatomical edge letters.
- A single-row chapter strip of small film frames, grouped into banks on the lit box.
- One exposure scale (D0 to D3) for all prominence; chinagraph yellow only for user marks and the active control.
- Condensed grotesk for labels and prose; data mono for anything the instrument prints.
- Square corners, hairline rules, no shadows.
- One motion clock (640ms, expo-out) for hanging films and drawing the active tick.

## Colors

A cold, blue-tinted film-density ramp in a near-black room, a daylight-white viewbox seen only at the seams, and two chinagraph pencils.

### Primary
- **Chinagraph Yellow** (mark): the user's pencil. Active-frame tick, checked choice, checked toggle, focus outline, text selection, input caret, the slider thumb while held or focused, the brief flash when a corner value changes, the selection crosshair on the cortex, and a chapter's live instruction while the user is drawing. Text on yellow uses **Pencil Ink** (mark-ink). The one non-interactive use is the pencil stroke in the SurfView mark and favicon, which depicts the world's own device: a chinagraph mark on a small film.

### Secondary
- **Chinagraph Red** (alert): errors only (chapter load failures, control errors, file-loading errors).

### Neutral
- **Unlit Room** (room): page background and the area outside the viewbox, including the margin.
- **Viewbox Daylight** (box): the lit box, visible as the chapter strip's background and the seam around the film. Also the fill of the one primary action. **Box Ink** (box-ink) is the only text set on it (vertical bank labels).
- **Film Base D0** (d0): the film sheet, code excerpt ground, select and toggle ground.
- **D1** (d1): resting chapter frames, the copy button, option lists.
- **D2** (d2): hairline rules (film edge, margin sections, code block), hovered frames and actions.
- **D3** (d3): the active frame, slider track, control borders, scrollbar thumb.
- **Ink High / Ink / Ink Low** (ink-hi, ink, ink-lo): three ink densities on film. High for titles and values, Ink for prose and labels, Low for corner keys, captions, section headings and secondary notes.
- **Cortex Grey** (cortex): the base color of every rendered surface mesh, with curvature shading over it.

Figure content is not UI: exported atlas plates render on their own near-white paper with their own parcel palettes inside the film, because they preview the printed artifact. Those values belong to the chapter, not to the system.

### Named Rules
**The Chinagraph Rule.** Yellow means the user did it or is doing it. If an element is not a user mark, a selected value, or the control in hand, it does not get yellow.

**The Exposure Rule.** State changes move one step up the D scale (D1 rest, D2 hover, D3 active). No new hue for hover, no tinted panels.

**The Seam Rule.** The viewbox's daylight appears only between and around sheets, never as a panel background for content.

## Typography

**UI Font:** Archivo Variable (with Archivo, system-ui), driven on its width axis.
**Data Font:** JetBrains Mono Variable (with JetBrains Mono, ui-monospace).

**Character:** A condensed grotesk at several widths (72% for titles up to 96% for prose) does the speaking; a plain mono with tabular figures does the instrument printing. The two never swap roles.

### Hierarchy
- **Display** (640, clamp(26px, 2.1vw, 34px), 1.04, width 72%): the chapter title at the top of the margin. One per screen.
- **Title** (700, 19px, width 78%): the SurfView wordmark.
- **Body** (400, 15px, 1.5, width 96%): base text. The chapter summary runs at 14.5px / 1.55, max 62ch; margin notes 13px; synthetic-data notes 12.5px in Ink Low with a "Synthetic data." lead in Ink.
- **Label** (520, 13.5px, width 84 to 88%): frame titles, control labels, buttons; frame subjects at 11.5px in Ink Low.
- **Section label** (650, 11.5px, 0.12em, uppercase, width 78%): margin control-group headings in Ink Low. Bank labels on the strip are the same voice at 10.5px, 0.14em, set vertically in Box Ink.
- **Data, corner** (11.5px, 1.35, tabular): corner overlay lines; key uppercase at 0.08em in Ink Low, value in Ink High.
- **Data, edge** (10.5px, 0.1em, uppercase): the edge printing along the film's bottom.
- **Data, code** (12px, 1.6): code excerpts. Slider outputs and readouts are mono 12.5px, tabular.
- **Orientation letters** (600, 15px, width 78%, Ink Low): the R/L/A/P/S/I letters at the film's edges.

### Named Rules
**The Instrument Voice Rule.** Anything the viewer measures or reports (values, vertex ids, counts, status, code) is set in the data mono with tabular figures. Prose and control names are never mono.

## Layout

The page is a room: a header row (wordmark, tagline, project links), the chapter strip, then the viewbox. The viewbox is a two-column grid: the film (minmax(0, 1fr)) and an unlit margin (clamp(300px, 27vw, 400px)) with a 30px left inset. The film's height is clamp(440px, 100vh − 196px, 1100px); the margin matches it and scrolls internally.

The chapter strip is one horizontal row of frames on the lit box, grouped into banks (Surfaces, Atlases, Workflows) with a vertical bank label each. Frames are separated by the 6px seam, banks by 14px, and the strip scrolls sideways rather than wrapping.

The margin stacks title, summary, synthetic note, the collapsed code excerpt, control sections, and a Reset footer pinned to the bottom, separated by hairline rules rather than containers. Atlas tools that bring their own controls use a **wide layout**: the film takes the full width and the margin moves above it as a two-column header strip.

Responsive: below 1100px the margin drops under the film (film clamp(380px, 62vh, 720px)) and the tagline hides. Below 620px the room padding goes to zero, the film is 68vh, the top-right corner lines print as a continuation of the top-left column (so they stay clear of the top orientation letter), long corner values wrap under their key instead of truncating, and the perf readout hides.

## Elevation & Depth

Flat. Depth is film density, not light: an element comes forward by moving up the D scale, and the lit seam of the viewbox separates sheets. There are no shadows anywhere; the time-series chapter explicitly strips the radius and shadow a library overlay brings with it. The only translucent layer is the "Exposing…" veil (D0 at 55%) over a film that is still loading.

### Named Rules
**The Lightbox Rule.** Nothing casts a shadow. A sheet is separated from what is around it by the seam or by a density step.

## Shapes

Square everywhere (0 radius): frames, buttons, choices, selects, toggles (including a square toggle knob), slider thumbs (a 10 by 18px bar), code blocks, and library components themed into the world. The film sheet carries one silhouette device: a small notch code cut into its top-right edge (a 10 by 7px rectangle clipped out 20px from the corner), as on a real sheet of film. Rules are 1px hairlines in D2; control borders are 1px in D3.

## Components

### Chapter frames
Small hung films on the lit strip.
- **Shape:** square, min 64 by 56px, padding 9/12/13px.
- **Default:** D1 ground, title in Ink, one-word subject beneath in Ink Low.
- **Hover:** D2, title to Ink High. **Active:** D3, Ink High, and a 2px Chinagraph Yellow tick drawn left-to-right along the bottom on the motion clock.
- **Focus:** the yellow outline, inset 4px.

### Buttons (actions)
- **Shape:** square, 1px D3 border, padding 7/13/8px, label type.
- **Default:** transparent with Ink High text. **Hover:** border to Ink Low, ground to D2. **Active:** D3.
- **Pressed (toggle actions):** border and text Chinagraph Yellow.
- **Primary:** Viewbox Daylight ground with D0 text, brightening to white on hover. Used sparingly, for the single main action of a panel.
- **Disabled:** Ink Low at 60% opacity.

### Choice groups
Segmented radio sets in a grid (three columns by default, 4px gaps). Each option is a bordered square cell in Ink; hover lifts border to Ink Low and text to Ink High; the checked option takes a yellow border and yellow text.

### Inputs / Fields
- **Select:** D0 ground, 1px D3 border, Ink High text, a thin Ink Low chevron; hover border to Ink Low.
- **Slider:** 2px D3 track, square Ink thumb; Ink High on hover; yellow while held or focused. The current value prints in mono beside the label and, when configured, into a film corner.
- **Toggle:** 30 by 16px square track, D0 with an Ink Low border; checked turns the border yellow, the ground an 18% yellow tint, and slides a square yellow knob.
- **Focus:** a 2px Chinagraph Yellow outline at 2px offset, globally.

### Film sheet with corner overlay (signature)
The film is a D0 sheet inside a 6px daylight seam, with the viewer filling it. Four corner overlays print labelled mono lines (key in Ink Low uppercase, value in Ink High); when a value changes it flashes yellow and settles back to Ink High over 900ms, so operating a control visibly prints into the film. Orientation letters track the camera at the four edges. Along the bottom, an edge strip separated by a D2 hairline prints the library mark, the running status, and a tabular perf readout in the edge mono. A newly hung film fades up from an over-bright, low-contrast flash on the motion clock.

### Code excerpt
A disclosure in the margin bounded by D2 rules, with a small rotating chevron drawn from two Ink Low strokes. Open, it shows a D0 block in the code mono (max 440px tall, scrolling) with a small Copy action in its top-right corner.

### Navigation
Header links are condensed label text in Ink that turn Ink High and underline on hover; the npm link carries the live version. Chapter navigation is the strip above.

## Do's and Don'ts

### Do:
- **Do** take every surface color from the D scale and every text color from the three inks; hover and active move one D step.
- **Do** reserve Chinagraph Yellow for user marks, the selected value, and the control in hand, and Chinagraph Red for errors.
- **Do** print live state into the film corners with the shared overlay, so a control's value appears on the sheet as it moves.
- **Do** set measured values, counts, status and code in the data mono with tabular figures.
- **Do** keep corners square (0) and separate regions with 1px D2 hairlines.
- **Do** time sheet-level transitions on the one motion clock (640ms, expo-out) and honor reduced motion.
- **Do** render meshes in Cortex Grey with curvature shading on the film base.

### Don't:
- **Don't** fill a content panel with Viewbox Daylight; the lit box shows only at seams and in the one primary action.
- **Don't** box the margin into cards or panels; controls are readouts on the dark room separated by rules.
- **Don't** add shadows or rounded corners, including to library components dropped into a chapter.
- **Don't** use yellow for decoration or emphasis; beyond the wordmark's pencil stroke, it marks only what the user did or holds.
- **Don't** introduce a cyan or other accent hue for UI state.
