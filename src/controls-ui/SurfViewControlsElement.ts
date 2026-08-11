import { css, html, LitElement } from 'lit';
import { guard } from 'lit/directives/guard.js';
import type {
  AnatomicalViewTargetDescriptor,
  AnatomicalViewTargetRef,
  ControlCommandResult,
  FigureExportRequest,
  HistogramControlDescriptor,
  InspectionSelection,
  LayerControlDescriptor,
  NumericRangeControlDescriptor,
  ScalarMappingControls,
  SurfaceControlDescriptor,
  SurfViewControlSession,
  SurfViewControlSessionSnapshot,
  SurfViewControlSubscription
} from '../index';
import type { AnatomicalView } from '../AnatomicalView';
import type { BlendMode } from '../layers';
import {
  normalizeSurfViewControlsFeatures
} from './features';
import type {
  SurfViewControlsFeature,
  SurfViewControlsFeatureOptions
} from './features';

export const SURFVIEW_CONTROLS_TAG = 'surfview-controls';

export type SurfViewControlsTheme = 'auto' | 'light' | 'dark';
export type SurfViewControlsDensity = 'compact' | 'comfortable';

interface ExportDialogState {
  readonly width: number;
  readonly height: number;
  readonly dpi: number;
  readonly transparent: boolean;
  readonly colorbar: boolean;
  readonly filename: string;
  readonly title: string;
  readonly subtitle: string;
}

/**
 * Inline, Shadow DOM host for the optional first-party control surface.
 *
 * The element observes only a headless session. It never receives a viewer,
 * Three.js object, surface, layer instance, or raw data array.
 */
export class SurfViewControlsElement extends LitElement {
  static properties = {
    controlLabel: { type: String, attribute: 'control-label' },
    theme: { type: String, reflect: true },
    density: { type: String, reflect: true },
    features: { attribute: false }
  };

  static styles = css`
    :host {
      box-sizing: border-box;
      color: var(--surfview-controls-color, CanvasText);
      color-scheme: light dark;
      container-type: inline-size;
      display: block;
      font: inherit;
      min-inline-size: 14rem;
    }

    :host([theme='light']) {
      --surfview-controls-background: #ffffff;
      --surfview-controls-control-background: #ffffff;
      --surfview-controls-color: #17212b;
      --surfview-controls-muted: #5e6b78;
      --surfview-controls-border: #d9dfe6;
      --surfview-controls-border-strong: #aeb8c3;
      --surfview-controls-subtle: #f5f7f9;
      --surfview-controls-focus: #315f8c;
      --surfview-controls-focus-soft: #e8f0f7;
      --surfview-controls-focus-text: #173a5e;
      --surfview-controls-error: #b42318;
      color-scheme: light;
    }

    :host([theme='dark']) {
      --surfview-controls-background: #121820;
      --surfview-controls-control-background: #18212b;
      --surfview-controls-color: #edf2f7;
      --surfview-controls-muted: #a4b0bd;
      --surfview-controls-border: #303b47;
      --surfview-controls-border-strong: #526171;
      --surfview-controls-subtle: #17202a;
      --surfview-controls-focus: #75a7d4;
      --surfview-controls-focus-soft: #20394f;
      --surfview-controls-focus-text: #f3f8fc;
      --surfview-controls-error: #ff9b8f;
      color-scheme: dark;
    }

    @media (prefers-color-scheme: dark) {
      :host([theme='auto']) {
        --surfview-controls-background: #121820;
        --surfview-controls-control-background: #18212b;
        --surfview-controls-color: #edf2f7;
        --surfview-controls-muted: #a4b0bd;
        --surfview-controls-border: #303b47;
        --surfview-controls-border-strong: #526171;
        --surfview-controls-subtle: #17202a;
        --surfview-controls-focus: #75a7d4;
        --surfview-controls-focus-soft: #20394f;
        --surfview-controls-focus-text: #f3f8fc;
        --surfview-controls-error: #ff9b8f;
      }
    }

    *,
    *::before,
    *::after {
      box-sizing: inherit;
    }

    .panel {
      background: var(--surfview-controls-background, Canvas);
      border: 1px solid var(--surfview-controls-border, color-mix(in srgb, CanvasText 18%, transparent));
      border-radius: var(--surfview-controls-radius, 0.5rem);
      color: inherit;
      overflow: clip;
    }

    .header {
      align-items: baseline;
      border-block-end: 1px solid var(--surfview-controls-border, color-mix(in srgb, CanvasText 18%, transparent));
      display: flex;
      gap: 0.75rem;
      justify-content: space-between;
      padding: 0.75rem 0.875rem;
    }

    .title {
      font-size: 0.875rem;
      font-weight: 650;
      letter-spacing: 0.01em;
      margin: 0;
    }

    .status {
      color: var(--surfview-controls-muted, color-mix(in srgb, CanvasText 62%, transparent));
      font-size: 0.75rem;
      margin: 0;
      white-space: nowrap;
    }

    .content {
      min-block-size: 2.5rem;
    }

    .section {
      border-block-end: 1px solid var(--surfview-controls-border, color-mix(in srgb, CanvasText 18%, transparent));
      padding: 0.875rem;
    }

    .section:last-child {
      border-block-end: 0;
    }

    .section-heading,
    .surface-title {
      margin: 0;
    }

    .section-heading {
      font-size: 0.8125rem;
      font-weight: 700;
      letter-spacing: 0.04em;
      text-transform: uppercase;
    }

    .layers-heading-row {
      align-items: baseline;
      display: flex;
      gap: 0.75rem;
      justify-content: space-between;
    }

    .section-description,
    .target-label,
    .stack-direction,
    .surface-meta,
    .layer-meta,
    .preview-name {
      color: var(--surfview-controls-muted, color-mix(in srgb, CanvasText 62%, transparent));
      font-size: 0.75rem;
      line-height: 1.35;
    }

    .section-description,
    .target-label {
      margin: 0.25rem 0 0;
    }

    .stack-direction {
      margin: 0;
      white-space: nowrap;
    }

    .view-options {
      border: 0;
      display: grid;
      gap: 0.375rem;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      margin: 0.75rem 0 0;
      padding: 0;
    }

    .view-options legend {
      block-size: 0;
      inline-size: 0;
      overflow: hidden;
      position: absolute;
    }

    .view-option {
      min-inline-size: 0;
      position: relative;
    }

    .view-option input {
      block-size: 1px;
      clip: rect(0 0 0 0);
      clip-path: inset(50%);
      inline-size: 1px;
      overflow: hidden;
      position: absolute;
      white-space: nowrap;
    }

    .view-option span,
    button,
    select,
    input[type='range'] {
      font: inherit;
    }

    .view-option span,
    button,
    select {
      border: 1px solid var(--surfview-controls-border-strong, color-mix(in srgb, CanvasText 28%, transparent));
      border-radius: 0.375rem;
    }

    .view-option span {
      align-items: center;
      background: transparent;
      cursor: pointer;
      display: flex;
      font-size: 0.75rem;
      justify-content: center;
      min-block-size: 2rem;
      padding: 0.375rem;
      text-align: center;
    }

    .view-option input:checked + span {
      background: var(--surfview-controls-focus-soft, color-mix(in srgb, Highlight 14%, transparent));
      border-color: var(--surfview-controls-focus, Highlight);
      color: var(--surfview-controls-focus-text, CanvasText);
      font-weight: 650;
    }

    .view-option input:focus-visible + span,
    button:focus-visible,
    select:focus-visible,
    input[type='range']:focus-visible,
    input[type='checkbox']:focus-visible,
    input[type='color']:focus-visible,
    input[type='text']:focus-visible {
      outline: 2px solid var(--surfview-controls-focus, Highlight);
      outline-offset: 2px;
    }

    .view-option input:disabled + span,
    button:disabled,
    select:disabled,
    input:disabled {
      cursor: not-allowed;
      opacity: 0.52;
    }

    .view-actions {
      display: flex;
      gap: 0.5rem;
      margin-block-start: 0.625rem;
    }

    button,
    select {
      background: var(--surfview-controls-control-background, Canvas);
      color: inherit;
      min-block-size: 2rem;
      padding: 0.375rem 0.625rem;
    }

    button:not(:disabled) {
      cursor: pointer;
    }

    .surface-list,
    .layer-list {
      list-style: none;
      margin: 0;
      padding: 0;
    }

    .surface-list {
      display: grid;
      gap: 0.875rem;
      margin-block-start: 0.625rem;
    }

    .surface {
      min-inline-size: 0;
    }

    .surface + .surface {
      border-block-start: 1px solid var(--surfview-controls-border, color-mix(in srgb, CanvasText 18%, transparent));
      padding-block-start: 0.75rem;
    }

    .surface-header {
      align-items: center;
      display: flex;
      gap: 0.625rem;
      justify-content: space-between;
      padding: 0 0.125rem 0.375rem;
    }

    .surface-title {
      font-size: 0.8125rem;
      font-weight: 650;
    }

    .surface-meta,
    .layer-meta,
    .preview-name {
      display: block;
      margin-block-start: 0.125rem;
    }

    .visibility-control {
      align-items: center;
      display: inline-flex;
      font-size: 0.75rem;
      gap: 0.375rem;
      white-space: nowrap;
    }

    .layer-list {
      border-block: 1px solid var(--surfview-controls-border, color-mix(in srgb, CanvasText 12%, transparent));
      counter-reset: stack-layer;
    }

    .layer-row {
      border-block-start: 1px solid var(--surfview-controls-border, color-mix(in srgb, CanvasText 12%, transparent));
      counter-increment: stack-layer;
      display: grid;
      gap: 0.375rem;
      grid-template-columns: minmax(0, 1fr) auto;
      padding: 0.375rem 0.125rem 0.375rem 0.375rem;
    }

    .layer-row:first-child {
      border-block-start: 0;
    }

    .layer-row[data-focused='true'] {
      background: var(--surfview-controls-focus-soft, color-mix(in srgb, Highlight 14%, transparent));
      box-shadow: inset 3px 0 0 var(--surfview-controls-focus, Highlight);
    }

    .layer-summary {
      align-items: center;
      display: grid;
      gap: 0.625rem;
      grid-template-columns: auto minmax(0, 1fr);
      min-inline-size: 0;
    }

    .color-preview {
      background: var(--layer-preview);
      border: 1px solid var(--surfview-controls-border-strong, color-mix(in srgb, CanvasText 28%, transparent));
      border-radius: 0.2rem;
      block-size: 1.5rem;
      inline-size: 2.25rem;
    }

    .color-preview-empty {
      background:
        linear-gradient(135deg, transparent 46%, var(--surfview-controls-border-strong) 48% 52%, transparent 54%),
        var(--surfview-controls-subtle, color-mix(in srgb, CanvasText 4%, transparent));
    }

    .layer-focus {
      background: transparent;
      border: 0;
      border-radius: 0.2rem;
      min-block-size: 2.25rem;
      min-inline-size: 0;
      padding: 0.2rem 0.25rem;
      text-align: start;
    }

    .layer-focus[aria-pressed='true'] {
      color: var(--surfview-controls-focus-text, CanvasText);
    }

    .layer-title-line {
      align-items: center;
      display: flex;
      gap: 0.375rem;
      min-inline-size: 0;
    }

    .layer-name {
      display: block;
      font-size: 0.8125rem;
      font-weight: 650;
      min-inline-size: 0;
      overflow-wrap: anywhere;
    }

    .focus-indicator {
      background: var(--surfview-controls-focus, Highlight);
      border-radius: 999px;
      color: var(--surfview-controls-background, Canvas);
      flex: 0 0 auto;
      font-size: 0.625rem;
      font-weight: 700;
      letter-spacing: 0.02em;
      line-height: 1;
      padding: 0.2rem 0.35rem;
      text-transform: uppercase;
    }

    .layer-details {
      color: var(--surfview-controls-muted, color-mix(in srgb, CanvasText 62%, transparent));
      display: flex;
      font-size: 0.75rem;
      gap: 0.25rem;
      margin-block-start: 0.125rem;
      min-inline-size: 0;
      overflow: hidden;
      white-space: nowrap;
    }

    .layer-details > span:not(.sr-only) {
      min-inline-size: 0;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .layer-details .preview-name {
      display: inline;
      margin-block-start: 0;
    }

    .layer-details > span:not(.sr-only) + span:not(.sr-only)::before {
      content: '·';
      margin-inline-end: 0.25rem;
    }

    .layer-constraint {
      color: var(--surfview-controls-color, CanvasText);
      font-weight: 600;
    }

    .layer-actions {
      align-items: center;
      display: flex;
      gap: 0.25rem;
    }

    .layer-actions button {
      min-inline-size: 2rem;
      padding-inline: 0.45rem;
    }

    .layer-visibility {
      block-size: 2rem;
      inline-size: 2rem;
      justify-content: center;
    }

    .opacity-control,
    .blend-control {
      display: grid;
      font-size: 0.75rem;
      gap: 0.25rem;
    }

    .opacity-label {
      display: flex;
      justify-content: space-between;
    }

    .selected-layer-header {
      align-items: start;
      display: flex;
      gap: 0.75rem;
      justify-content: space-between;
      margin-block-start: 0.5rem;
    }

    .selected-layer-title {
      font-size: 0.9375rem;
      font-weight: 680;
      margin: 0;
      overflow-wrap: anywhere;
    }

    .selected-layer-subtitle {
      color: var(--surfview-controls-muted, color-mix(in srgb, CanvasText 62%, transparent));
      font-size: 0.75rem;
      margin: 0.125rem 0 0;
    }

    .selected-preview {
      background: var(--layer-preview);
      border: 1px solid var(--surfview-controls-border-strong, color-mix(in srgb, CanvasText 28%, transparent));
      border-radius: 0.25rem;
      block-size: 0.875rem;
      inline-size: 5rem;
      margin-block-start: 0.25rem;
    }

    .selected-general-controls,
    .scalar-controls {
      display: grid;
      gap: 0.75rem;
      margin-block-start: 0.75rem;
    }

    .selected-general-controls {
      align-items: end;
      grid-template-columns: minmax(7rem, 1fr) minmax(6.5rem, 0.65fr);
    }

    .scalar-controls {
      border-block-start: 1px solid var(--surfview-controls-border, color-mix(in srgb, CanvasText 14%, transparent));
      padding-block-start: 0.75rem;
    }

    .control-group {
      border: 0;
      display: grid;
      gap: 0.5rem;
      margin: 0;
      padding: 0;
    }

    .control-group legend,
    .control-label {
      font-size: 0.75rem;
      font-weight: 650;
    }

    .colormap-control {
      display: grid;
      gap: 0.375rem;
    }

    .colormap-strip {
      background: var(--layer-preview);
      border: 1px solid var(--surfview-controls-border-strong, color-mix(in srgb, CanvasText 28%, transparent));
      border-radius: 0.2rem;
      block-size: 0.875rem;
      inline-size: 100%;
    }

    .histogram-frame {
      background: var(--surfview-controls-subtle, color-mix(in srgb, CanvasText 4%, transparent));
      border: 1px solid var(--surfview-controls-border, color-mix(in srgb, CanvasText 18%, transparent));
      border-radius: 0.25rem;
      overflow: hidden;
    }

    .histogram {
      block-size: 4.5rem;
      display: block;
      inline-size: 100%;
    }

    .histogram-bar {
      fill: var(--surfview-controls-histogram, color-mix(in srgb, CanvasText 38%, transparent));
    }

    .mask-band {
      fill: var(--surfview-controls-mask, color-mix(in srgb, #d92d20 30%, transparent));
      stroke: var(--surfview-controls-mask-border, #d92d20);
      stroke-dasharray: 2 2;
      stroke-width: 0.5;
    }

    .summary-line,
    .mask-explanation,
    .range-error {
      color: var(--surfview-controls-muted, color-mix(in srgb, CanvasText 62%, transparent));
      font-size: 0.75rem;
      line-height: 1.4;
      margin: 0;
    }

    .range-error {
      color: var(--surfview-controls-error, #b42318);
    }

    .numeric-pair,
    .range-sliders {
      display: grid;
      gap: 0.5rem;
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    .numeric-control {
      display: grid;
      font-size: 0.75rem;
      gap: 0.25rem;
    }

    input[type='number'] {
      background: var(--surfview-controls-control-background, Canvas);
      border: 1px solid var(--surfview-controls-border-strong, color-mix(in srgb, CanvasText 28%, transparent));
      border-radius: 0.375rem;
      color: inherit;
      font: inherit;
      inline-size: 100%;
      min-block-size: 2rem;
      padding: 0.375rem 0.5rem;
    }

    input[type='number']:focus-visible {
      outline: 2px solid var(--surfview-controls-focus, Highlight);
      outline-offset: 2px;
    }

    .symmetric-lock {
      align-items: center;
      display: inline-flex;
      font-size: 0.75rem;
      gap: 0.375rem;
    }

    .selection-heading-row {
      align-items: baseline;
      display: flex;
      gap: 0.75rem;
      justify-content: space-between;
    }

    .selection-kind {
      color: var(--surfview-controls-muted, color-mix(in srgb, CanvasText 62%, transparent));
      font-size: 0.75rem;
      margin: 0;
    }

    .selection-empty-state {
      color: var(--surfview-controls-muted, color-mix(in srgb, CanvasText 62%, transparent));
      font-size: 0.75rem;
      margin: 0.375rem 0 0;
    }

    .selection-facts,
    .selection-values {
      display: grid;
      gap: 0;
      margin: 0.625rem 0 0;
    }

    .selection-values-heading {
      font-size: 0.75rem;
      font-weight: 650;
      margin: 0.75rem 0 0;
    }

    .selection-fact,
    .selection-value {
      border-block-start: 1px solid var(--surfview-controls-border, color-mix(in srgb, CanvasText 12%, transparent));
      display: grid;
      gap: 0.5rem;
      grid-template-columns: minmax(6.5rem, 0.7fr) minmax(0, 1fr);
      padding-block: 0.4rem;
    }

    .selection-fact:first-child,
    .selection-value:first-child {
      border-block-start: 0;
    }

    .selection-fact dt,
    .selection-value dt,
    .selection-fact dd,
    .selection-value dd {
      font-size: 0.75rem;
      margin: 0;
      overflow-wrap: anywhere;
    }

    .selection-fact dt,
    .selection-value dt {
      color: var(--surfview-controls-muted, color-mix(in srgb, CanvasText 62%, transparent));
    }

    .selection-value[data-emphasized='true'] {
      background: var(--surfview-controls-focus-soft, color-mix(in srgb, Highlight 14%, transparent));
      box-shadow: inset 3px 0 0 var(--surfview-controls-focus, Highlight);
      margin-inline: -0.375rem;
      padding-inline: 0.375rem;
    }

    .value-context {
      color: var(--surfview-controls-focus, Highlight);
      display: block;
      font-size: 0.6875rem;
      font-weight: 650;
      margin-block-start: 0.125rem;
    }

    .missing-value {
      font-weight: 650;
    }

    .world-coordinate {
      display: inline-block;
      font-variant-numeric: tabular-nums;
      margin-inline-end: 0.625rem;
      white-space: nowrap;
    }

    code {
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      font-size: 0.95em;
    }

    input[type='range'] {
      inline-size: 100%;
      margin: 0;
    }

    .message {
      color: var(--surfview-controls-muted, color-mix(in srgb, CanvasText 62%, transparent));
      font-size: 0.75rem;
      margin: 0.625rem 0 0;
    }

    .message[data-tone='error'] {
      color: var(--surfview-controls-error, #b42318);
    }

    .figure-summary {
      align-items: end;
      display: grid;
      gap: 0.625rem;
      grid-template-columns: minmax(7rem, 1fr) minmax(8rem, 1fr) auto;
      margin-block-start: 0.75rem;
    }

    .figure-control,
    .export-field {
      display: grid;
      font-size: 0.75rem;
      gap: 0.25rem;
    }

    .background-control {
      align-items: center;
      display: grid;
      gap: 0.5rem;
      grid-template-columns: 2.25rem minmax(0, 1fr);
    }

    input[type='color'] {
      background: var(--surfview-controls-control-background, Canvas);
      border: 1px solid var(--surfview-controls-border-strong, color-mix(in srgb, CanvasText 28%, transparent));
      border-radius: 0.375rem;
      block-size: 2rem;
      inline-size: 2.25rem;
      padding: 0.125rem;
    }

    .background-value,
    .figure-defaults,
    .figure-availability {
      color: var(--surfview-controls-muted, color-mix(in srgb, CanvasText 62%, transparent));
      font-size: 0.75rem;
      font-variant-numeric: tabular-nums;
    }

    .figure-defaults,
    .figure-availability {
      margin: 0.625rem 0 0;
    }

    .figure-transparency {
      align-items: center;
      display: inline-flex;
      font-size: 0.75rem;
      gap: 0.375rem;
      margin-block-start: 0.625rem;
    }

    .export-action {
      white-space: nowrap;
    }

    .export-dialog {
      background: var(--surfview-controls-background, Canvas);
      border: 1px solid var(--surfview-controls-border-strong, color-mix(in srgb, CanvasText 28%, transparent));
      border-radius: var(--surfview-controls-radius, 0.5rem);
      box-shadow: 0 1rem 3rem rgb(0 0 0 / 0.28);
      color: var(--surfview-controls-color, CanvasText);
      font: inherit;
      inline-size: min(32rem, calc(100vw - 2rem));
      max-block-size: min(42rem, calc(100vh - 2rem));
      overflow: auto;
      padding: 0;
    }

    .export-dialog::backdrop {
      background: rgb(7 12 18 / 0.55);
    }

    .export-form {
      display: grid;
      gap: 0;
    }

    .export-header {
      border-block-end: 1px solid var(--surfview-controls-border, color-mix(in srgb, CanvasText 18%, transparent));
      padding: 0.875rem 1rem;
    }

    .export-title {
      font-size: 1rem;
      margin: 0;
    }

    .export-description {
      color: var(--surfview-controls-muted, color-mix(in srgb, CanvasText 62%, transparent));
      font-size: 0.75rem;
      line-height: 1.4;
      margin: 0.25rem 0 0;
    }

    .export-fields {
      display: grid;
      gap: 0.75rem;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      padding: 1rem;
    }

    .export-field-wide {
      grid-column: 1 / -1;
    }

    .export-field input[type='text'],
    .export-field input[type='number'] {
      background: var(--surfview-controls-control-background, Canvas);
      border: 1px solid var(--surfview-controls-border-strong, color-mix(in srgb, CanvasText 28%, transparent));
      border-radius: 0.375rem;
      color: inherit;
      font: inherit;
      inline-size: 100%;
      min-block-size: 2rem;
      padding: 0.375rem 0.5rem;
    }

    .export-options {
      display: flex;
      flex-wrap: wrap;
      gap: 0.75rem 1rem;
      grid-column: 1 / -1;
    }

    .export-options label {
      align-items: center;
      display: inline-flex;
      font-size: 0.75rem;
      gap: 0.375rem;
    }

    .export-error {
      color: var(--surfview-controls-error, #b42318);
      font-size: 0.75rem;
      grid-column: 1 / -1;
      margin: 0;
    }

    .export-actions {
      border-block-start: 1px solid var(--surfview-controls-border, color-mix(in srgb, CanvasText 18%, transparent));
      display: flex;
      gap: 0.5rem;
      justify-content: end;
      padding: 0.75rem 1rem;
    }

    .export-submit {
      background: var(--surfview-controls-focus, Highlight);
      border-color: var(--surfview-controls-focus, Highlight);
      color: var(--surfview-controls-background, Canvas);
      font-weight: 650;
    }

    .sr-only {
      block-size: 1px;
      clip: rect(0 0 0 0);
      clip-path: inset(50%);
      inline-size: 1px;
      overflow: hidden;
      position: absolute;
      white-space: nowrap;
    }

    .empty {
      color: var(--surfview-controls-muted, color-mix(in srgb, CanvasText 62%, transparent));
      font-size: 0.8125rem;
      margin: 0;
      padding: 0.875rem;
    }

    @container (max-width: 22rem) {
      .view-options {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }

      .surface-header {
        align-items: start;
      }

      .selected-general-controls,
      .numeric-pair,
      .range-sliders,
      .figure-summary,
      .export-fields {
        grid-template-columns: minmax(0, 1fr);
      }

      .export-field-wide,
      .export-options,
      .export-error {
        grid-column: 1;
      }

      .selection-fact,
      .selection-value {
        gap: 0.125rem;
        grid-template-columns: minmax(0, 1fr);
      }

    }

    @container (max-width: 18rem) {
      .layer-row {
        grid-template-columns: minmax(0, 1fr);
      }

      .layer-actions {
        grid-column: 1;
        justify-content: end;
      }
    }

    :host([density='compact']) .header {
      padding: 0.5rem 0.625rem;
    }

    :host([density='compact']) .section {
      padding: 0.625rem;
    }

    :host([density='compact']) .surface-list,
    :host([density='compact']) .selected-general-controls,
    :host([density='compact']) .scalar-controls,
    :host([density='compact']) .figure-summary {
      gap: 0.5rem;
      margin-block-start: 0.5rem;
    }

    :host([density='compact']) .layer-row {
      padding-block: 0.25rem;
    }

    :host([density='compact']) button,
    :host([density='compact']) select,
    :host([density='compact']) input[type='number'],
    :host([density='compact']) input[type='text'] {
      min-block-size: 1.75rem;
      padding-block: 0.25rem;
    }
  `;

  controlLabel = 'SurfView controls';
  theme: SurfViewControlsTheme = 'auto';
  density: SurfViewControlsDensity = 'comfortable';
  private currentFeatures = normalizeSurfViewControlsFeatures(undefined);
  private currentSession: SurfViewControlSession | null = null;
  private currentSnapshot: SurfViewControlSessionSnapshot | null = null;
  private sessionSubscription: SurfViewControlSubscription | null = null;
  private commandMessage = '';
  private commandMessageTone: 'status' | 'error' = 'status';
  private selectionIdentity: string | null = null;
  private selectionAnnouncement = '';
  private exportDialogOpen = false;
  private exportPending = false;
  private exportError = '';
  private exportGeneration = 0;
  private exportReturnFocus: HTMLElement | null = null;
  private exportState: ExportDialogState = {
    width: 1200,
    height: 900,
    dpi: 150,
    transparent: false,
    colorbar: true,
    filename: 'surfview.png',
    title: '',
    subtitle: ''
  };

  get features(): SurfViewControlsFeatureOptions {
    return this.currentFeatures;
  }

  set features(features: SurfViewControlsFeatureOptions) {
    const previous = this.currentFeatures;
    const next = normalizeSurfViewControlsFeatures(features);
    if (next.include?.length === previous.include?.length &&
        next.include?.every((feature, index) => feature === previous.include?.[index])) {
      return;
    }
    this.currentFeatures = next;
    if (!this.hasFeature('figure')) this.closeExportDialog(false);
    this.requestUpdate('features', previous);
  }

  get session(): SurfViewControlSession | null {
    return this.currentSession;
  }

  set session(session: SurfViewControlSession | null) {
    if (session === this.currentSession) return;
    const previous = this.currentSession;
    this.closeExportDialog(false);
    this.disconnectSession();
    this.currentSession = session;
    this.currentSnapshot = session?.getSnapshot() ?? null;
    this.selectionIdentity = this.currentSnapshot
      ? this.selectionKey(this.currentSnapshot)
      : null;
    this.selectionAnnouncement = '';
    if (this.isConnected) this.connectSession();
    this.requestUpdate('session', previous);
  }

  get snapshot(): SurfViewControlSessionSnapshot | null {
    return this.currentSnapshot;
  }

  override connectedCallback(): void {
    super.connectedCallback();
    this.connectSession();
  }

  override disconnectedCallback(): void {
    this.closeExportDialog(false);
    this.disconnectSession();
    super.disconnectedCallback();
  }

  /** Release element-local subscriptions without taking ownership of a session. */
  dispose(): void {
    this.closeExportDialog(false);
    this.disconnectSession();
    this.currentSession = null;
    this.currentSnapshot = null;
    this.selectionIdentity = null;
    this.selectionAnnouncement = '';
    this.remove();
  }

  protected override render() {
    const surfaceCount = this.currentSnapshot?.canonical.surfaces.length ?? 0;
    const layerCount = this.currentSnapshot?.canonical.surfaces.reduce(
      (count, surface) => count + surface.layers.length,
      0
    ) ?? 0;
    const status = this.currentSnapshot
      ? `${surfaceCount} ${surfaceCount === 1 ? 'surface' : 'surfaces'} · ` +
        `${layerCount} ${layerCount === 1 ? 'layer' : 'layers'}`
      : 'Not connected';

    return html`
      <section class="panel" part="panel" role="region" aria-label=${this.controlLabel}>
        <header class="header" part="header">
          <h2 class="title">SurfView</h2>
          <p class="status" aria-live="off">${status}</p>
        </header>
        <div class="content" part="content">
          ${this.currentSnapshot
            ? html`
                ${this.hasFeature('view')
                  ? this.renderViewSection(this.currentSnapshot)
                  : null}
                ${this.hasFeature('layers')
                  ? this.renderLayersSection(this.currentSnapshot)
                  : null}
                ${this.hasFeature('layer-inspector')
                  ? this.renderSelectedLayerSection(this.currentSnapshot)
                  : null}
                ${this.hasFeature('selection')
                  ? this.renderSelectionSection(this.currentSnapshot)
                  : null}
                ${this.hasFeature('figure')
                  ? this.renderFigureSection(this.currentSnapshot)
                  : null}
                ${this.commandMessage
                  ? html`<p
                      class="message"
                      data-tone=${this.commandMessageTone}
                      role="status"
                    >${this.commandMessage}</p>`
                  : null}
                <slot></slot>
              `
            : html`<p class="empty">Connect a control session to begin.</p>`}
        </div>
        ${this.currentSnapshot && this.hasFeature('figure')
          ? this.renderExportDialog()
          : null}
      </section>
    `;
  }

  private renderViewSection(snapshot: SurfViewControlSessionSnapshot) {
    const view = snapshot.canonical.view;
    const target = this.resolveViewTarget(snapshot);
    const targetLabel = target?.label ?? 'No anatomical target available';
    const availableViews = view.anatomicalViews.filter(
      option => option.availability.enabled
    );

    return html`
      <section class="section view-section" aria-labelledby="surfview-view-heading">
        <h3 class="section-heading" id="surfview-view-heading">View</h3>
        <p class="target-label">Applies to ${targetLabel}</p>
        ${availableViews.length > 0 && target
          ? html`
              <fieldset class="view-options">
                <legend>Anatomical view</legend>
                ${availableViews.map(option => html`
                  <label class="view-option" title=${option.availability.reason ?? ''}>
                    <input
                      type="radio"
                      name="anatomical-view"
                      value=${option.id}
                      .checked=${this.isCurrentView(snapshot, option.id, target.target)}
                      ?disabled=${!option.availability.enabled || !target.availability.enabled}
                      @change=${() => this.applyAnatomicalView(option.id, target.target)}
                    >
                    <span>${option.label}</span>
                  </label>
                `)}
              </fieldset>
            `
          : html`
              <p class="section-description">
                ${view.anatomicalViews[0]?.availability.reason ??
                  'Load an anatomically identified surface to enable views.'}
              </p>
            `}
        <div class="view-actions">
          <button
            type="button"
            ?disabled=${!view.fit.enabled}
            title=${view.fit.reason ?? 'Fit the current surface view'}
            @click=${() => this.runCommand(this.currentSession?.fitView())}
          >Fit</button>
          <button
            type="button"
            ?disabled=${!view.reset.enabled}
            title=${view.reset.reason ?? 'Reset the anatomical view'}
            @click=${() => this.runCommand(this.currentSession?.resetView())}
          >Reset</button>
        </div>
      </section>
    `;
  }

  private renderLayersSection(snapshot: SurfViewControlSessionSnapshot) {
    const { canonical } = snapshot;
    return html`
      <section class="section layers-section" aria-labelledby="surfview-layers-heading">
        <div class="layers-heading-row">
          <h3 class="section-heading" id="surfview-layers-heading">Layers</h3>
          <p class="stack-direction" aria-label="Compositing order, bottom to top">
            Bottom → top
          </p>
        </div>
        ${canonical.surfaces.length === 0
          ? html`<p class="section-description">No surfaces or layers are loaded.</p>`
          : html`
              <ul class="surface-list">
                ${canonical.surfaces.map(surface => this.renderSurface(snapshot, surface))}
              </ul>
            `}
      </section>
    `;
  }

  private renderSurface(
    snapshot: SurfViewControlSessionSnapshot,
    surface: SurfaceControlDescriptor
  ) {
    const visibilityAvailable = snapshot.canonical.capabilities.surfaceVisibility.enabled;
    return html`
      <li class="surface" data-surface-id=${surface.id}>
        <div class="surface-header">
          <div>
            <h4 class="surface-title">${surface.label}</h4>
            <span class="surface-meta">
              ${this.labelFromId(surface.hemisphere)} hemisphere ·
              ${surface.layers.length} ${surface.layers.length === 1 ? 'layer' : 'layers'}
            </span>
          </div>
          ${visibilityAvailable
            ? html`
                <label class="visibility-control">
                  <input
                    type="checkbox"
                    .checked=${surface.visible}
                    aria-label=${`Show ${surface.label}`}
                    @change=${(event: Event) => this.setSurfaceVisibility(
                      surface.id,
                      (event.currentTarget as HTMLInputElement).checked
                    )}
                  >
                  Visible
                </label>
              `
            : null}
        </div>
        ${surface.layers.length === 0
          ? html`<p class="empty">This surface has no controllable layers.</p>`
          : html`
              <ol class="layer-list" aria-label="${surface.label} layers, bottom to top">
                ${surface.layers.map((layer, index) =>
                  this.renderLayer(snapshot, surface, layer, index)
                )}
              </ol>
            `}
      </li>
    `;
  }

  private renderLayer(
    snapshot: SurfViewControlSessionSnapshot,
    surface: SurfaceControlDescriptor,
    layer: LayerControlDescriptor,
    index: number
  ) {
    const capabilities = snapshot.canonical.capabilities;
    const focused = snapshot.state.focusedSurfaceId === surface.id &&
      snapshot.state.focusedLayerId === layer.id;
    const canMoveUp = capabilities.layerOrder.enabled && layer.moveUp.enabled;
    const canMoveDown = capabilities.layerOrder.enabled && layer.moveDown.enabled;
    const constraintLabel = this.layerConstraintLabel(layer);
    const detailsId = this.layerDetailsId(surface.id, layer.id);
    const moveUpReasonId = this.layerMoveReasonId(surface.id, layer.id, 'up');
    const moveDownReasonId = this.layerMoveReasonId(surface.id, layer.id, 'down');

    return html`
      <li
        class="layer-row"
        data-layer-id=${layer.id}
        data-layer-index=${layer.index}
        data-focused=${focused ? 'true' : 'false'}
      >
        <div class="layer-summary">
          ${layer.colorPreview
            ? html`
                <span
                  class="color-preview"
                  style=${`--layer-preview: ${this.safeColorPreviewCss(
                    layer.colorPreview.css
                  )}`}
                  role="img"
                  aria-label=${`Color preview: ${layer.colorPreview.label}`}
                ></span>
              `
            : html`<span class="color-preview color-preview-empty" aria-hidden="true"></span>`}
          <button
            class="layer-focus"
            type="button"
            aria-pressed=${focused ? 'true' : 'false'}
            aria-label=${`Focus ${layer.label} for editing`}
            aria-describedby=${detailsId}
            ?disabled=${!surface.visible || !layer.visible}
            @click=${() => this.focusLayer(surface.id, layer.id)}
          >
            <span class="layer-title-line">
              <span class="layer-name">${layer.label}</span>
              ${focused ? html`<span class="focus-indicator">Editing</span>` : null}
            </span>
            <span class="layer-details" id=${detailsId}>
              <span class="sr-only">${this.labelFromId(layer.role)} layer.</span>
              ${layer.colorPreview
                ? html`<span class="preview-name">${layer.colorPreview.label}</span>`
                : null}
              <span>${Math.round(layer.opacity * 100)}%</span>
              <span>${this.labelFromId(layer.blendMode)}</span>
              ${constraintLabel
                ? html`<span class="layer-constraint">${constraintLabel}</span>`
                : null}
            </span>
          </button>
        </div>
        <div class="layer-actions">
          ${capabilities.layerVisibility.enabled
            ? html`
                <label
                  class="visibility-control layer-visibility"
                  title=${layer.visible ? `Hide ${layer.label}` : `Show ${layer.label}`}
                >
                  <input
                    type="checkbox"
                    .checked=${layer.visible}
                    aria-label=${`Show ${layer.label}`}
                    @change=${(event: Event) => this.setLayerVisibility(
                      surface.id,
                      layer.id,
                      (event.currentTarget as HTMLInputElement).checked
                    )}
                  >
                  <span class="sr-only">Visible</span>
                </label>
              `
            : null}
          ${capabilities.layerOrder.enabled
            ? html`
                <button
                  type="button"
                  aria-label=${`Move ${layer.label} up`}
                  aria-describedby=${canMoveUp ? null : moveUpReasonId}
                  title=${layer.moveUp.reason ?? 'Move up'}
                  ?disabled=${!canMoveUp}
                  @click=${() => this.moveLayer(surface, index, -1)}
                >↑</button>
                <button
                  type="button"
                  aria-label=${`Move ${layer.label} down`}
                  aria-describedby=${canMoveDown ? null : moveDownReasonId}
                  title=${layer.moveDown.reason ?? 'Move down'}
                  ?disabled=${!canMoveDown}
                  @click=${() => this.moveLayer(surface, index, 1)}
                >↓</button>
                ${!canMoveUp && layer.moveUp.reason
                  ? html`<span class="sr-only" id=${moveUpReasonId}>
                      Move up unavailable: ${layer.moveUp.reason}
                    </span>`
                  : null}
                ${!canMoveDown && layer.moveDown.reason
                  ? html`<span class="sr-only" id=${moveDownReasonId}>
                      Move down unavailable: ${layer.moveDown.reason}
                    </span>`
                  : null}
              `
            : null}
        </div>
      </li>
    `;
  }

  private renderSelectedLayerSection(snapshot: SurfViewControlSessionSnapshot) {
    const surface = snapshot.focus.surface;
    const layer = snapshot.focus.layer;
    if (!surface || !layer) return null;
    const capabilities = snapshot.canonical.capabilities;
    const hasGeneralControls = capabilities.layerOpacity.enabled ||
      capabilities.layerBlendMode.enabled;

    return html`
      <section
        class="section selected-layer-section"
        aria-labelledby="surfview-selected-layer-heading"
      >
        <h3 class="section-heading" id="surfview-selected-layer-heading">
          Selected layer
        </h3>
        <div class="selected-layer-header">
          <div>
            <h4 class="selected-layer-title">${layer.label}</h4>
            <p class="selected-layer-subtitle">
              ${surface.label}${layer.units ? html` · ${layer.units}` : null}
            </p>
            ${layer.description
              ? html`<p class="section-description">${layer.description}</p>`
              : null}
          </div>
          ${layer.colorPreview
            ? html`
                <span
                  class="selected-preview"
                  style=${`--layer-preview: ${this.safeColorPreviewCss(
                    layer.colorPreview.css
                  )}`}
                  title=${layer.colorPreview.label}
                  aria-hidden="true"
                ></span>
              `
            : null}
        </div>
        ${hasGeneralControls
          ? html`
              <div class="selected-general-controls">
                ${capabilities.layerOpacity.enabled
                  ? html`
                      <label class="opacity-control">
                        <span class="opacity-label">
                          <span>Opacity</span>
                          <output>${Math.round(layer.opacity * 100)}%</output>
                        </span>
                        <input
                          type="range"
                          min="0"
                          max="1"
                          step="0.01"
                          .value=${String(layer.opacity)}
                          aria-label=${`${layer.label} opacity`}
                          aria-valuetext=${`${Math.round(layer.opacity * 100)} percent`}
                          @input=${(event: Event) => this.setLayerOpacity(
                            surface.id,
                            layer.id,
                            Number((event.currentTarget as HTMLInputElement).value)
                          )}
                        >
                      </label>
                    `
                  : null}
                ${capabilities.layerBlendMode.enabled
                  ? html`
                      <label class="blend-control">
                        <span>Blend mode</span>
                        <select
                          .value=${layer.blendMode}
                          aria-label=${`${layer.label} blend mode`}
                          @change=${(event: Event) => this.setLayerBlendMode(
                            surface.id,
                            layer.id,
                            (event.currentTarget as HTMLSelectElement).value as BlendMode
                          )}
                        >
                          <option value="normal">Normal</option>
                          <option value="additive">Additive</option>
                          <option value="multiply">Multiply</option>
                        </select>
                      </label>
                    `
                  : null}
              </div>
            `
          : null}
        ${layer.scalarMapping
          ? layer.scalarMapping.availability.enabled
            ? this.renderScalarControls(surface.id, layer, layer.scalarMapping, snapshot)
            : html`
                <p class="section-description">
                  ${layer.scalarMapping.availability.reason ??
                    'Scalar mapping is temporarily unavailable.'}
                </p>
              `
          : null}
      </section>
    `;
  }

  private renderScalarControls(
    surfaceId: string,
    layer: LayerControlDescriptor,
    scalar: ScalarMappingControls,
    snapshot: SurfViewControlSessionSnapshot
  ) {
    const summary = snapshot.focus.scalarSummary ?? scalar.summary;
    return html`
      <div class="scalar-controls">
        <label class="colormap-control">
          <span class="control-label">Colormap</span>
          <span
            class="colormap-strip"
            style=${`--layer-preview: ${this.safeColorPreviewCss(
              layer.colorPreview?.css ?? 'transparent'
            )}`}
            role="img"
            aria-label=${`Colormap preview: ${scalar.colorMap.label}`}
          ></span>
          <select
            .value=${scalar.colorMap.id}
            aria-label=${`${layer.label} colormap`}
            @change=${(event: Event) => this.setScalarColorMap(
              surfaceId,
              layer.id,
              (event.currentTarget as HTMLSelectElement).value
            )}
          >
            ${scalar.availableColorMaps
              .filter(option => option.availability.enabled || option.id === scalar.colorMap.id)
              .map(option => html`
                <option
                  value=${option.id}
                  ?disabled=${!option.availability.enabled}
                  title=${option.availability.reason ?? ''}
                >${option.label}</option>
              `)}
          </select>
        </label>
        ${this.renderHistogram(summary?.histogram, scalar, summary?.finiteCount)}
        ${summary
          ? html`
              <p class="summary-line">
                ${summary.finiteCount.toLocaleString()} finite values ·
                ${summary.missingCount.toLocaleString()} missing ·
                data ${this.formatNullableNumber(summary.minimum)} to
                ${this.formatNullableNumber(summary.maximum)}
              </p>
            `
          : null}
        ${this.renderNumericRangeControl(
          surfaceId,
          layer,
          'display',
          'Display range',
          scalar.displayRange,
          snapshot.state.symmetricRangeLock
        )}
        <label class="symmetric-lock">
          <input
            type="checkbox"
            .checked=${snapshot.state.symmetricRangeLock}
            @change=${(event: Event) => this.toggleSymmetricRangeLock(
              surfaceId,
              layer.id,
              scalar.displayRange,
              (event.currentTarget as HTMLInputElement).checked
            )}
          >
          Lock display range symmetrically around zero
        </label>
        ${this.renderNumericRangeControl(
          surfaceId,
          layer,
          'mask',
          'Mask values between',
          scalar.maskInterval,
          false
        )}
        <p class="mask-explanation">
          ${scalar.maskInterval.value[0] === scalar.maskInterval.value[1]
            ? 'Masking off (equal endpoints).'
            : 'Values inside the interval are hidden; values outside remain visible.'}
        </p>
      </div>
    `;
  }

  private renderNumericRangeControl(
    surfaceId: string,
    layer: LayerControlDescriptor,
    kind: 'display' | 'mask',
    label: string,
    range: NumericRangeControlDescriptor,
    symmetric: boolean
  ) {
    const bounds = this.sliderBounds(range, symmetric);
    const step = this.rangeStep(range, bounds);
    return html`
      <fieldset class="control-group" data-range-kind=${kind}>
        <legend>${label}</legend>
        <div class="numeric-pair">
          ${(['lower', 'upper'] as const).map((bound, index) => html`
            <label class="numeric-control">
              <span>${bound === 'lower' ? 'Low' : 'High'}</span>
              <input
                type="number"
                step="any"
                .value=${String(range.value[index])}
                data-range-kind=${kind}
                data-bound=${bound}
                aria-label=${`${layer.label} ${label.toLowerCase()} ${bound}`}
                @input=${(event: Event) => {
                  (event.currentTarget as HTMLInputElement).setCustomValidity('');
                }}
                @change=${(event: Event) => this.commitNumericRange(
                  surfaceId,
                  layer.id,
                  kind,
                  event.currentTarget as HTMLInputElement
                )}
              >
            </label>
          `)}
        </div>
        <div class="range-sliders">
          ${(['lower', 'upper'] as const).map((bound, index) => html`
            <label class="numeric-control">
              <span class="sr-only">${label} ${bound}</span>
              <input
                type="range"
                min=${String(bounds[0])}
                max=${String(bounds[1])}
                step=${String(step)}
                .value=${String(range.value[index])}
                data-range-kind=${kind}
                data-bound=${bound}
                aria-label=${`${layer.label} ${label.toLowerCase()} ${bound} slider`}
                @input=${(event: Event) => this.setScalarRangeFromSlider(
                  surfaceId,
                  layer.id,
                  kind,
                  bound,
                  range,
                  Number((event.currentTarget as HTMLInputElement).value),
                  symmetric
                )}
              >
            </label>
          `)}
        </div>
      </fieldset>
    `;
  }

  private renderHistogram(
    histogram: HistogramControlDescriptor | undefined,
    scalar: ScalarMappingControls,
    finiteCount: number | undefined
  ) {
    if (!histogram || histogram.counts.length === 0 ||
        histogram.edges.length !== histogram.counts.length + 1) {
      return null;
    }
    const domainMinimum = histogram.edges[0];
    const domainMaximum = histogram.edges[histogram.edges.length - 1];
    const mask = this.maskBand(
      scalar.maskInterval.value,
      domainMinimum,
      domainMaximum
    );
    return html`
      <div class="histogram-frame">
        <svg
          class="histogram"
          viewBox="0 0 100 40"
          preserveAspectRatio="none"
          role="img"
          aria-label=${this.histogramLabel(finiteCount, scalar)}
        >
          ${guard([histogram], () => {
            const maximumCount = Math.max(1, ...histogram.counts);
            const width = 100 / histogram.counts.length;
            return histogram.counts.map((count, index) => {
              const height = Math.max(0, count) / maximumCount * 36;
              return html`
                <rect
                  class="histogram-bar"
                  x=${String(index * width)}
                  y=${String(40 - height)}
                  width=${String(Math.max(0, width - 0.25))}
                  height=${String(height)}
                ></rect>
              `;
            });
          })}
          ${mask
            ? html`
                <rect
                  class="mask-band"
                  x=${String(mask[0])}
                  y="0"
                  width=${String(mask[1])}
                  height="40"
                ></rect>
              `
            : null}
        </svg>
      </div>
    `;
  }

  private renderSelectionSection(snapshot: SurfViewControlSessionSnapshot) {
    const selection = snapshot.canonical.selection.current;
    const inspection = snapshot.canonical.selection.inspection;
    const empty = selection.kind === 'none';
    return html`
      <section
        class="section selection-section"
        data-empty=${empty ? 'true' : 'false'}
        aria-labelledby="surfview-selection-heading"
      >
        <div class="selection-heading-row">
          <h3 class="section-heading" id="surfview-selection-heading">Selection</h3>
          ${empty
            ? null
            : html`<p class="selection-kind">${this.labelFromId(selection.kind)}</p>`}
        </div>
        <p class="sr-only" aria-live="polite" aria-atomic="true">
          ${this.selectionAnnouncement}
        </p>
        ${selection.kind === 'none'
          ? html`
              <p class="selection-empty-state">
                No vertex or parcel selected.
              </p>
            `
          : html`
              ${this.renderSelectionFacts(selection, inspection)}
              ${inspection
                ? this.renderSelectionValues(snapshot, inspection)
                : html`
                    <p class="selection-empty-state">
                      ${selection.kind === 'parcel'
                        ? 'No representative vertex values are available for this parcel.'
                        : 'Inspection values are unavailable for the selected vertex.'}
                    </p>
                  `}
            `}
      </section>
    `;
  }

  private renderSelectionFacts(
    selection: Exclude<InspectionSelection, { readonly kind: 'none' }>,
    inspection: SurfViewControlSessionSnapshot['canonical']['selection']['inspection']
  ) {
    const parcelId = inspection?.parcel?.id ??
      (selection.kind === 'parcel' ? selection.parcelId : undefined);
    const parcelLabel = inspection?.parcel?.label;
    const atlasId = inspection?.atlas?.id ??
      (selection.kind === 'parcel' ? selection.atlasId : undefined);
    const atlasName = inspection?.atlas?.name;
    const representativeVertex = selection.kind === 'parcel'
      ? selection.representativeVertexIndex
      : undefined;
    return html`
      <dl class="selection-facts">
        <div class="selection-fact">
          <dt>Surface ID</dt>
          <dd><code>${selection.surfaceId}</code></dd>
        </div>
        ${selection.kind === 'vertex'
          ? html`
              <div class="selection-fact">
                <dt>Vertex index</dt>
                <dd><code>${selection.vertexIndex}</code></dd>
              </div>
            `
          : html`
              <div class="selection-fact">
                <dt>Parcel ID</dt>
                <dd>
                  <code>${selection.parcelId}</code>${parcelLabel
                    ? html` · ${parcelLabel}`
                    : null}
                </dd>
              </div>
              ${representativeVertex !== undefined
                ? html`
                    <div class="selection-fact">
                      <dt>Representative vertex</dt>
                      <dd><code>${representativeVertex}</code></dd>
                    </div>
                  `
                : null}
            `}
        ${inspection
          ? html`
              <div class="selection-fact">
                <dt>
                  ${selection.kind === 'parcel'
                    ? 'Representative vertex world coordinates'
                    : 'World coordinates'}
                </dt>
                <dd>
                  ${inspection.world.map((value, index) => html`
                    <span class="world-coordinate">
                      ${['X', 'Y', 'Z'][index]} ${this.formatInspectionNumber(value)}
                    </span>
                  `)}
                </dd>
              </div>
            `
          : null}
        ${selection.kind === 'vertex' && parcelId !== undefined
          ? html`
              <div class="selection-fact">
                <dt>Parcel</dt>
                <dd>
                  <code>${parcelId}</code>${parcelLabel ? html` · ${parcelLabel}` : null}
                </dd>
              </div>
            `
          : null}
        ${atlasId || atlasName
          ? html`
              <div class="selection-fact">
                <dt>Atlas</dt>
                <dd>
                  ${atlasName ?? 'Unnamed atlas'}${atlasId
                    ? html` · <code>${atlasId}</code>`
                    : null}
                </dd>
              </div>
            `
          : null}
      </dl>
    `;
  }

  private renderSelectionValues(
    snapshot: SurfViewControlSessionSnapshot,
    inspection: NonNullable<
      SurfViewControlSessionSnapshot['canonical']['selection']['inspection']
    >
  ) {
    const selection = snapshot.canonical.selection.current;
    const exclusiveMap = snapshot.canonical.capabilities.exclusiveMap;
    const displayedLayerId = exclusiveMap?.availability.enabled &&
      exclusiveMap.displayedLayerId !== null &&
      inspection.values.some(value => value.layerId === exclusiveMap.displayedLayerId)
      ? exclusiveMap.displayedLayerId
      : null;
    const focusedLayerId = snapshot.state.focusedSurfaceId === inspection.surfaceId
      ? snapshot.state.focusedLayerId
      : null;
    const emphasizedLayerId = displayedLayerId ?? focusedLayerId;
    const contextLabel = displayedLayerId ? 'Displayed layer' : 'Focused layer';
    if (inspection.values.length === 0) {
      return html`<p class="selection-empty-state">No layer values are available.</p>`;
    }
    const valuesLabel = selection.kind === 'parcel'
      ? `Layer values at representative vertex ${inspection.vertexIndex}`
      : `Layer values at selected vertex ${inspection.vertexIndex}`;
    return html`
      <h4 class="selection-values-heading">${valuesLabel}</h4>
      <dl class="selection-values" aria-label=${valuesLabel}>
        ${inspection.values.map(value => {
          const emphasized = value.layerId === emphasizedLayerId;
          const missing = value.missing || value.value === null;
          return html`
            <div
              class="selection-value"
              data-layer-value=${value.layerId}
              data-emphasized=${emphasized ? 'true' : 'false'}
              aria-current=${emphasized ? 'true' : 'false'}
            >
              <dt>
                ${value.label}
                ${emphasized
                  ? html`<span class="value-context">${contextLabel}</span>`
                  : null}
              </dt>
              <dd>
                ${missing
                  ? html`<span class="missing-value">Missing</span>`
                  : typeof value.value === 'number'
                    ? this.formatInspectionNumber(value.value)
                    : value.value}
                ${value.units ? html` <span class="value-units">${value.units}</span>` : null}
              </dd>
            </div>
          `;
        })}
      </dl>
    `;
  }

  private renderFigureSection(snapshot: SurfViewControlSessionSnapshot) {
    const figure = snapshot.canonical.figure;
    const capabilities = snapshot.canonical.capabilities;
    const background = this.figureBackgroundHex(figure.background);
    const presets = figure.availablePresets.filter(option =>
      option.availability.enabled || option.id === figure.preset.id
    );
    return html`
      <section
        class="section figure-section"
        aria-labelledby="surfview-figure-heading"
      >
        <h3 class="section-heading" id="surfview-figure-heading">Figure</h3>
        <div class="figure-summary">
          <label class="figure-control">
            <span class="control-label">Style preset</span>
            <select
              aria-label="Figure style preset"
              .value=${figure.preset.id}
              ?disabled=${!capabilities.figurePresets.enabled}
              title=${capabilities.figurePresets.reason ?? ''}
              @change=${(event: Event) => this.applyFigurePreset(
                (event.currentTarget as HTMLSelectElement).value
              )}
            >
              ${presets.map(option => html`
                <option
                  value=${option.id}
                  ?disabled=${!option.availability.enabled}
                  title=${option.availability.reason ?? ''}
                >${option.label}</option>
              `)}
            </select>
          </label>
          <label class="figure-control">
            <span class="control-label">Background</span>
            <span class="background-control">
              <input
                type="color"
                aria-label="Figure background color"
                .value=${background}
                ?disabled=${!capabilities.figureBackground.enabled}
                title=${capabilities.figureBackground.reason ?? ''}
                @input=${(event: Event) => this.setFigureBackgroundColor(
                  (event.currentTarget as HTMLInputElement).value
                )}
              >
              <output class="background-value">${background.toUpperCase()}</output>
            </span>
          </label>
          <button
            class="export-action"
            type="button"
            ?disabled=${!figure.exportPNG.enabled}
            title=${figure.exportPNG.reason ?? 'Configure and export a PNG figure'}
            @click=${(event: Event) => this.openExportDialog(event)}
          >Export…</button>
        </div>
        <label class="figure-transparency">
          <input
            type="checkbox"
            .checked=${figure.transparent}
            ?disabled=${!capabilities.figureBackground.enabled}
            @change=${(event: Event) => this.setFigureTransparency(
              (event.currentTarget as HTMLInputElement).checked
            )}
          >
          Transparent viewer background
        </label>
        <p class="figure-defaults">
          ${figure.preset.label} · ${figure.defaultWidth} × ${figure.defaultHeight} px ·
          ${figure.defaultDpi ?? 150} dpi
        </p>
        ${figure.exportPNG.enabled
          ? null
          : html`<p class="figure-availability">${figure.exportPNG.reason}</p>`}
      </section>
    `;
  }

  private renderExportDialog() {
    const state = this.exportState;
    return html`
      <dialog
        class="export-dialog"
        aria-labelledby="surfview-export-title"
        aria-describedby="surfview-export-description"
        aria-busy=${this.exportPending ? 'true' : 'false'}
        @cancel=${(event: Event) => {
          event.preventDefault();
          this.closeExportDialog(true);
        }}
      >
        <form
          class="export-form"
          @submit=${(event: SubmitEvent) => {
            event.preventDefault();
            void this.submitFigureExport(event.currentTarget as HTMLFormElement);
          }}
        >
          <header class="export-header">
            <h3 class="export-title" id="surfview-export-title">Export PNG</h3>
            <p class="export-description" id="surfview-export-description">
              Configure this download. These values do not alter the live scene.
            </p>
          </header>
          <div class="export-fields">
            <label class="export-field">
              <span>Width (px)</span>
              <input
                type="number"
                name="width"
                min="1"
                max="16384"
                step="1"
                required
                .value=${String(state.width)}
                @input=${(event: Event) => this.updateExportState(
                  'width',
                  (event.currentTarget as HTMLInputElement).valueAsNumber
                )}
              >
            </label>
            <label class="export-field">
              <span>Height (px)</span>
              <input
                type="number"
                name="height"
                min="1"
                max="16384"
                step="1"
                required
                .value=${String(state.height)}
                @input=${(event: Event) => this.updateExportState(
                  'height',
                  (event.currentTarget as HTMLInputElement).valueAsNumber
                )}
              >
            </label>
            <label class="export-field">
              <span>DPI</span>
              <input
                type="number"
                name="dpi"
                min="1"
                max="2400"
                step="1"
                required
                .value=${String(state.dpi)}
                @input=${(event: Event) => this.updateExportState(
                  'dpi',
                  (event.currentTarget as HTMLInputElement).valueAsNumber
                )}
              >
            </label>
            <label class="export-field">
              <span>Filename</span>
              <input
                type="text"
                name="filename"
                required
                .value=${state.filename}
                @input=${(event: Event) => this.updateExportState(
                  'filename',
                  (event.currentTarget as HTMLInputElement).value
                )}
              >
            </label>
            <label class="export-field export-field-wide">
              <span>Title</span>
              <input
                type="text"
                name="title"
                .value=${state.title}
                @input=${(event: Event) => this.updateExportState(
                  'title',
                  (event.currentTarget as HTMLInputElement).value
                )}
              >
            </label>
            <label class="export-field export-field-wide">
              <span>Subtitle</span>
              <input
                type="text"
                name="subtitle"
                .value=${state.subtitle}
                @input=${(event: Event) => this.updateExportState(
                  'subtitle',
                  (event.currentTarget as HTMLInputElement).value
                )}
              >
            </label>
            <div class="export-options" role="group" aria-label="PNG options">
              <label>
                <input
                  type="checkbox"
                  name="transparent"
                  .checked=${state.transparent}
                  @change=${(event: Event) => this.updateExportState(
                    'transparent',
                    (event.currentTarget as HTMLInputElement).checked
                  )}
                >
                Transparent background
              </label>
              <label>
                <input
                  type="checkbox"
                  name="colorbar"
                  .checked=${state.colorbar}
                  @change=${(event: Event) => this.updateExportState(
                    'colorbar',
                    (event.currentTarget as HTMLInputElement).checked
                  )}
                >
                Include colorbar
              </label>
            </div>
            ${this.exportError
              ? html`<p class="export-error" role="alert">${this.exportError}</p>`
              : null}
          </div>
          <footer class="export-actions">
            <button
              type="button"
              ?disabled=${this.exportPending}
              @click=${() => this.closeExportDialog(true)}
            >Cancel</button>
            <button
              class="export-submit"
              type="submit"
              ?disabled=${this.exportPending}
            >${this.exportPending ? 'Exporting…' : 'Export PNG'}</button>
          </footer>
        </form>
      </dialog>
    `;
  }

  private resolveViewTarget(
    snapshot: SurfViewControlSessionSnapshot
  ): AnatomicalViewTargetDescriptor | null {
    const targets = snapshot.canonical.view.targets.filter(
      target => target.availability.enabled
    );
    const current = snapshot.canonical.view.current;
    if (current) {
      const currentTarget = targets.find(candidate =>
        this.sameViewTarget(candidate.target, current.target)
      );
      if (currentTarget) return currentTarget;
    }
    const focusedSurface = snapshot.focus.surface;
    if (focusedSurface?.groupId) {
      const groupTarget = targets.find(candidate =>
        candidate.target.kind === 'group' &&
        candidate.target.groupId === focusedSurface.groupId
      );
      if (groupTarget) return groupTarget;
    }
    if (focusedSurface) {
      const surfaceTarget = targets.find(candidate =>
        candidate.target.kind === 'surface' &&
        candidate.target.surfaceId === focusedSurface.id
      );
      if (surfaceTarget) return surfaceTarget;
    }
    return targets[0] ?? null;
  }

  private isCurrentView(
    snapshot: SurfViewControlSessionSnapshot,
    view: AnatomicalView,
    target: AnatomicalViewTargetRef
  ): boolean {
    const current = snapshot.canonical.view.current;
    return current?.view === view && this.sameViewTarget(current.target, target);
  }

  private sameViewTarget(
    left: AnatomicalViewTargetRef,
    right: AnatomicalViewTargetRef
  ): boolean {
    return left.kind === right.kind && (left.kind === 'surface'
      ? right.kind === 'surface' && left.surfaceId === right.surfaceId
      : right.kind === 'group' && left.groupId === right.groupId);
  }

  private applyAnatomicalView(
    view: AnatomicalView,
    target: AnatomicalViewTargetRef
  ): void {
    this.runCommand(this.currentSession?.setAnatomicalView({
      view,
      target,
      fit: false
    }));
  }

  private setSurfaceVisibility(surfaceId: string, visible: boolean): void {
    this.runCommand(this.currentSession?.setSurfaceVisibility(surfaceId, visible));
  }

  private applyFigurePreset(presetId: string): void {
    this.runCommand(this.currentSession?.applyFigurePreset(presetId));
  }

  private setFigureBackgroundColor(value: string): void {
    const background = /^#[0-9a-f]{6}$/i.test(value)
      ? Number.parseInt(value.slice(1), 16)
      : Number.NaN;
    if (!Number.isInteger(background)) return;
    const transparent = this.currentSnapshot?.canonical.figure.transparent ?? false;
    this.runCommand(this.currentSession?.setFigureBackground(background, transparent));
  }

  private setFigureTransparency(transparent: boolean): void {
    const background = this.currentSnapshot?.canonical.figure.background;
    if (background === undefined) return;
    this.runCommand(this.currentSession?.setFigureBackground(background, transparent));
  }

  private openExportDialog(event: Event): void {
    const figure = this.currentSnapshot?.canonical.figure;
    if (!figure?.exportPNG.enabled || !this.currentSession) return;
    this.exportGeneration += 1;
    this.exportPending = false;
    this.exportError = '';
    this.exportReturnFocus = event.currentTarget instanceof HTMLElement
      ? event.currentTarget
      : null;
    this.exportState = {
      width: figure.defaultWidth,
      height: figure.defaultHeight,
      dpi: figure.defaultDpi ?? 150,
      transparent: figure.defaultTransparent ?? figure.transparent,
      colorbar: figure.defaultColorbar ?? true,
      filename: 'surfview.png',
      title: '',
      subtitle: ''
    };
    this.exportDialogOpen = true;
    this.requestUpdate();
    void this.updateComplete.then(() => {
      if (!this.exportDialogOpen || !this.isConnected) return;
      const dialog = this.renderRoot.querySelector<HTMLDialogElement>('.export-dialog');
      if (!dialog) return;
      if (!dialog.open) {
        if (typeof dialog.showModal === 'function') dialog.showModal();
        else dialog.setAttribute('open', '');
      }
      dialog.querySelector<HTMLInputElement>('input[name="width"]')?.focus();
    });
  }

  private closeExportDialog(restoreFocus: boolean): void {
    if (!this.exportDialogOpen && !this.exportPending) return;
    this.exportDialogOpen = false;
    this.exportPending = false;
    this.exportError = '';
    this.exportGeneration += 1;
    const dialog = this.renderRoot.querySelector<HTMLDialogElement>('.export-dialog');
    if (dialog?.open) {
      if (typeof dialog.close === 'function') dialog.close();
      else dialog.removeAttribute('open');
    }
    const returnFocus = this.exportReturnFocus;
    this.exportReturnFocus = null;
    this.requestUpdate();
    if (restoreFocus && returnFocus?.isConnected) {
      queueMicrotask(() => returnFocus.focus());
    }
  }

  private updateExportState<K extends keyof ExportDialogState>(
    key: K,
    value: ExportDialogState[K]
  ): void {
    this.exportState = { ...this.exportState, [key]: value };
  }

  private async submitFigureExport(form: HTMLFormElement): Promise<void> {
    if (!form.reportValidity() || this.exportPending || !this.currentSession) return;
    const state = this.exportState;
    if (![state.width, state.height, state.dpi].every(value =>
      Number.isInteger(value) && value > 0
    )) {
      this.exportError = 'Width, height, and DPI must be positive integers.';
      this.requestUpdate();
      return;
    }
    const filename = state.filename.trim();
    if (!filename) {
      this.exportError = 'Enter a filename.';
      this.requestUpdate();
      return;
    }
    const request: FigureExportRequest = {
      width: state.width,
      height: state.height,
      dpi: state.dpi,
      transparent: state.transparent,
      colorbar: state.colorbar,
      filename,
      ...(state.title.trim() ? { title: state.title.trim() } : {}),
      ...(state.subtitle.trim() ? { subtitle: state.subtitle.trim() } : {})
    };
    const generation = this.exportGeneration + 1;
    this.exportGeneration = generation;
    this.exportPending = true;
    this.exportError = '';
    this.requestUpdate();
    try {
      const result = await this.currentSession.exportFigure(request);
      if (generation !== this.exportGeneration || !this.exportDialogOpen) return;
      this.exportPending = false;
      if (!result.ok) {
        this.exportError = result.message;
        this.requestUpdate();
        return;
      }
      this.commandMessageTone = 'status';
      this.commandMessage = `Exported ${result.value.width} × ${result.value.height} PNG.`;
      this.closeExportDialog(true);
    } catch (error) {
      if (generation !== this.exportGeneration || !this.exportDialogOpen) return;
      this.exportPending = false;
      this.exportError = error instanceof Error ? error.message : 'PNG export failed.';
      this.requestUpdate();
    }
  }

  private figureBackgroundHex(background: number): string {
    const safe = Number.isInteger(background) && background >= 0 && background <= 0xffffff
      ? background
      : 0;
    return `#${safe.toString(16).padStart(6, '0')}`;
  }

  private hasFeature(feature: SurfViewControlsFeature): boolean {
    return this.currentFeatures.include?.includes(feature) ?? true;
  }

  private focusLayer(surfaceId: string, layerId: string): void {
    this.runCommand(this.currentSession?.setFocusedLayer({ surfaceId, layerId }));
  }

  private setLayerVisibility(
    surfaceId: string,
    layerId: string,
    visible: boolean
  ): void {
    this.runCommand(this.currentSession?.setLayerVisibility(
      { surfaceId, layerId },
      visible
    ));
  }

  private setLayerOpacity(
    surfaceId: string,
    layerId: string,
    opacity: number
  ): void {
    this.runCommand(this.currentSession?.setLayerOpacity(
      { surfaceId, layerId },
      opacity
    ));
  }

  private setLayerBlendMode(
    surfaceId: string,
    layerId: string,
    blendMode: BlendMode
  ): void {
    this.runCommand(this.currentSession?.setLayerBlendMode(
      { surfaceId, layerId },
      blendMode
    ));
  }

  private setScalarColorMap(
    surfaceId: string,
    layerId: string,
    colorMapId: string
  ): void {
    this.runCommand(this.currentSession?.updateScalarMapping(
      { surfaceId, layerId },
      { colorMapId }
    ));
  }

  private commitNumericRange(
    surfaceId: string,
    layerId: string,
    kind: 'display' | 'mask',
    changedInput: HTMLInputElement
  ): void {
    const inputs = [...this.renderRoot.querySelectorAll<HTMLInputElement>(
      `input[type="number"][data-range-kind="${kind}"]`
    )];
    const lowerInput = inputs.find(input => input.dataset.bound === 'lower');
    const upperInput = inputs.find(input => input.dataset.bound === 'upper');
    if (!lowerInput || !upperInput) return;
    const lower = lowerInput.valueAsNumber;
    const upper = upperInput.valueAsNumber;
    const symmetric = kind === 'display' &&
      this.currentSnapshot?.state.symmetricRangeLock === true;
    let message = '';
    if (!Number.isFinite(lower) || !Number.isFinite(upper)) {
      message = 'Enter two finite numeric bounds.';
    } else if (!symmetric && lower > upper) {
      message = 'Low must be less than or equal to High.';
    }
    for (const input of inputs) input.setCustomValidity(message);
    if (message) {
      changedInput.reportValidity();
      return;
    }
    if (symmetric) {
      const extent = Math.abs(changedInput.valueAsNumber);
      this.updateScalarRange(surfaceId, layerId, kind, [-extent, extent]);
    } else {
      this.updateScalarRange(surfaceId, layerId, kind, [lower, upper]);
    }
  }

  private toggleSymmetricRangeLock(
    surfaceId: string,
    layerId: string,
    range: NumericRangeControlDescriptor,
    enabled: boolean
  ): void {
    if (!this.currentSession) return;
    if (!enabled) {
      this.runCommand(this.currentSession.setSymmetricRangeLock(false));
      return;
    }
    const extent = Math.max(Math.abs(range.value[0]), Math.abs(range.value[1]));
    const symmetricRange = [-extent, extent] as const;
    if (range.value[0] !== symmetricRange[0] || range.value[1] !== symmetricRange[1]) {
      const result = this.currentSession.updateScalarMapping(
        { surfaceId, layerId },
        { displayRange: symmetricRange }
      );
      if (!result.ok) {
        this.runCommand(result);
        return;
      }
    }
    this.runCommand(this.currentSession.setSymmetricRangeLock(true));
  }

  private setScalarRangeFromSlider(
    surfaceId: string,
    layerId: string,
    kind: 'display' | 'mask',
    bound: 'lower' | 'upper',
    range: NumericRangeControlDescriptor,
    value: number,
    symmetric: boolean
  ): void {
    if (!Number.isFinite(value)) return;
    let next: readonly [number, number];
    if (kind === 'display' && symmetric) {
      const extent = Math.abs(value);
      next = [-extent, extent];
    } else if (bound === 'lower') {
      next = [Math.min(value, range.value[1]), range.value[1]];
    } else {
      next = [range.value[0], Math.max(value, range.value[0])];
    }
    this.updateScalarRange(surfaceId, layerId, kind, next);
  }

  private updateScalarRange(
    surfaceId: string,
    layerId: string,
    kind: 'display' | 'mask',
    value: readonly [number, number]
  ): void {
    this.runCommand(this.currentSession?.updateScalarMapping(
      { surfaceId, layerId },
      kind === 'display' ? { displayRange: value } : { maskInterval: value }
    ));
  }

  private sliderBounds(
    range: NumericRangeControlDescriptor,
    symmetric: boolean
  ): readonly [number, number] {
    let minimum = range.minimum;
    let maximum = range.maximum;
    if (symmetric) {
      const extent = Math.max(Math.abs(minimum), Math.abs(maximum), 1e-12);
      minimum = -extent;
      maximum = extent;
    }
    if (minimum === maximum) {
      const padding = Math.max(Math.abs(minimum) * 0.1, 1);
      minimum -= padding;
      maximum += padding;
    }
    return [minimum, maximum];
  }

  private rangeStep(
    range: NumericRangeControlDescriptor,
    bounds: readonly [number, number]
  ): number {
    if (range.step !== undefined && Number.isFinite(range.step) && range.step > 0) {
      return range.step;
    }
    return Math.max((bounds[1] - bounds[0]) / 200, Number.EPSILON);
  }

  private maskBand(
    interval: readonly [number, number],
    domainMinimum: number,
    domainMaximum: number
  ): readonly [number, number] | null {
    if (!Number.isFinite(domainMinimum) || !Number.isFinite(domainMaximum) ||
        domainMinimum >= domainMaximum || interval[0] === interval[1]) {
      return null;
    }
    const lower = Math.max(domainMinimum, Math.min(domainMaximum, interval[0]));
    const upper = Math.max(domainMinimum, Math.min(domainMaximum, interval[1]));
    if (upper <= lower) return null;
    const span = domainMaximum - domainMinimum;
    return [(lower - domainMinimum) / span * 100, (upper - lower) / span * 100];
  }

  private histogramLabel(
    finiteCount: number | undefined,
    scalar: ScalarMappingControls
  ): string {
    const interval = scalar.maskInterval.value;
    const mask = interval[0] === interval[1]
      ? 'masking off'
      : `masking values from ${this.formatNumber(interval[0])} to ` +
        this.formatNumber(interval[1]);
    const count = finiteCount === undefined
      ? 'finite scalar values'
      : `${finiteCount.toLocaleString()} finite values`;
    return `Histogram of ${count}; ${mask}.`;
  }

  private formatNullableNumber(value: number | null): string {
    return value === null ? 'not available' : this.formatNumber(value);
  }

  private formatNumber(value: number): string {
    return Number.isFinite(value) ? value.toLocaleString(undefined, {
      maximumSignificantDigits: 6
    }) : 'not available';
  }

  private formatInspectionNumber(value: number): string {
    if (!Number.isFinite(value)) return 'not available';
    return Object.is(value, -0) ? '-0' : value.toString();
  }

  private moveLayer(
    surface: SurfaceControlDescriptor,
    index: number,
    offset: -1 | 1
  ): void {
    const layer = surface.layers[index];
    const availability = offset < 0 ? layer?.moveUp : layer?.moveDown;
    if (!availability?.enabled) return;
    const ids = surface.layers.map(layer => layer.id);
    const destination = index + offset;
    [ids[index], ids[destination]] = [ids[destination], ids[index]];
    this.runCommand(this.currentSession?.setLayerOrder(surface.id, ids));
  }

  private layerConstraintLabel(layer: LayerControlDescriptor): string | null {
    if (layer.pinned) return `Pinned ${layer.pinned}`;
    if (!layer.reorderable) return 'Fixed position';
    return null;
  }

  private labelFromId(value: string): string {
    return value
      .replace(/[-_]+/g, ' ')
      .replace(/\b\w/g, letter => letter.toUpperCase());
  }

  private safeColorPreviewCss(cssValue: string): string {
    const css = cssValue.trim();
    if (css.length === 0 || css.length > 512 || /[;{}@\\]|url\s*\(/i.test(css)) {
      return 'transparent';
    }
    const color = /^(?:#[0-9a-f]{3,8}|(?:rgb|rgba|hsl|hsla)\([0-9.,%+\- /]+\))$/i;
    const gradient = /^linear-gradient\([a-z0-9#.,%+\- ()]+\)$/i;
    return color.test(css) || gradient.test(css) ? css : 'transparent';
  }

  private layerMoveReasonId(
    surfaceId: string,
    layerId: string,
    direction: 'up' | 'down'
  ): string {
    return this.layerDomId(surfaceId, layerId, `move-${direction}-reason`);
  }

  private layerDetailsId(surfaceId: string, layerId: string): string {
    return this.layerDomId(surfaceId, layerId, 'details');
  }

  private layerDomId(surfaceId: string, layerId: string, suffix: string): string {
    const value = `${surfaceId}\u0000${layerId}\u0000${suffix}`;
    let hash = 2166136261;
    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return `surfview-layer-${suffix}-${(hash >>> 0).toString(36)}`;
  }

  private runCommand(result: ControlCommandResult | undefined): void {
    if (!result) return;
    this.commandMessageTone = result.ok ? 'status' : 'error';
    this.commandMessage = result.ok ? '' : result.message;
    this.requestUpdate();
  }

  private selectionKey(snapshot: SurfViewControlSessionSnapshot): string {
    return JSON.stringify(snapshot.canonical.selection.current);
  }

  private announcementForSelection(snapshot: SurfViewControlSessionSnapshot): string {
    const selection = snapshot.canonical.selection.current;
    if (selection.kind === 'none') return 'Selection cleared.';
    if (selection.kind === 'vertex') {
      return `Selected vertex ${selection.vertexIndex} on surface ${selection.surfaceId}.`;
    }
    const representative = selection.representativeVertexIndex === undefined
      ? ''
      : `, representative vertex ${selection.representativeVertexIndex}`;
    const atlas = selection.atlasId === undefined ? '' : `, atlas ${selection.atlasId}`;
    return `Selected parcel ${selection.parcelId} on surface ${selection.surfaceId}` +
      `${representative}${atlas}.`;
  }

  private connectSession(): void {
    if (this.sessionSubscription || !this.currentSession) return;
    this.sessionSubscription = this.currentSession.subscribe(snapshot => {
      const nextSelectionIdentity = this.selectionKey(snapshot);
      if (this.selectionIdentity !== null &&
          nextSelectionIdentity !== this.selectionIdentity) {
        this.selectionAnnouncement = this.announcementForSelection(snapshot);
      }
      this.selectionIdentity = nextSelectionIdentity;
      this.currentSnapshot = snapshot;
      this.requestUpdate();
    });
  }

  private disconnectSession(): void {
    this.sessionSubscription?.unsubscribe();
    this.sessionSubscription = null;
  }
}

/** Register the element explicitly and idempotently. Importing does not call this. */
export function defineSurfViewControlsElement(): typeof SurfViewControlsElement {
  const elementBase = globalThis.HTMLElement;
  const registry = globalThis.customElements;
  if (!elementBase || !registry) {
    throw new Error('SurfView controls require a browser DOM and CustomElementRegistry.');
  }
  if (!(SurfViewControlsElement.prototype instanceof elementBase)) {
    throw new Error(
      'SurfView controls must be imported after the current DOM realm is available.'
    );
  }
  const existing = registry.get(SURFVIEW_CONTROLS_TAG);
  if (existing && existing !== SurfViewControlsElement) {
    throw new Error(
      `Custom element "${SURFVIEW_CONTROLS_TAG}" is already defined by another constructor.`
    );
  }
  if (!existing) {
    registry.define(SURFVIEW_CONTROLS_TAG, SurfViewControlsElement);
  }
  return SurfViewControlsElement;
}
