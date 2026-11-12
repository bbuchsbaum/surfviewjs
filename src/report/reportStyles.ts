/**
 * Default stylesheet of the compact report toolbar and mount status.
 *
 * Every rule is wrapped in `:where()`, so it has zero specificity: any host
 * selector (a class, an element name, an attribute) overrides it without
 * `!important`. Colours and sizes read CSS custom properties with built-in
 * fallbacks, so a host can also theme the toolbar by setting, on the toolbar
 * or any ancestor:
 *
 * | Property | Default | Used for |
 * |---|---|---|
 * | `--surfview-report-bg` | `#f8fafc` | toolbar and status background |
 * | `--surfview-report-fg` | `#111827` | text |
 * | `--surfview-report-muted` | `#475569` | tick labels, loading status |
 * | `--surfview-report-border` | `#d7dde5` | toolbar border |
 * | `--surfview-report-radius` | `6px` | toolbar corner radius |
 * | `--surfview-report-font` | `12px/1.4 system-ui, sans-serif` | toolbar font |
 * | `--surfview-report-gap` | `6px` | spacing between controls |
 * | `--surfview-report-padding` | `7px` | toolbar padding |
 * | `--surfview-report-error` | `#991b1b` | command and load errors |
 * | `--surfview-report-error-bg` | `#fef2f2` | load error background |
 * | `--surfview-report-slider-width` | `90px` | reference opacity slider |
 * | `--surfview-report-colorbar-width` | `160px` | colour bar length |
 * | `--surfview-report-colorbar-height` | `10px` | colour bar thickness |
 * | `--surfview-report-colorbar-border` | `rgba(17, 24, 39, 0.35)` | colour bar outline and ticks |
 * | `--surfview-report-mask` | `#e5e7eb` | sub-threshold band |
 * | `--surfview-report-mask-stripe` | `#9ca3af` | sub-threshold band hatching |
 */
export const REPORT_STYLES = `
:where(.surfview-report-controls) {
  align-items: center;
  background: var(--surfview-report-bg, #f8fafc);
  border: 1px solid var(--surfview-report-border, #d7dde5);
  border-radius: var(--surfview-report-radius, 6px);
  box-sizing: border-box;
  color: var(--surfview-report-fg, #111827);
  display: flex;
  flex-wrap: wrap;
  font: var(--surfview-report-font, 12px/1.4 system-ui, sans-serif);
  gap: var(--surfview-report-gap, 6px);
  margin-bottom: 8px;
  padding: var(--surfview-report-padding, 7px);
}
:where(.surfview-report-controls) :where(fieldset) {
  align-items: center;
  border: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin: 0;
  min-width: 0;
  padding: 0;
}
:where(.surfview-report-controls) :where(legend) {
  float: left;
  margin-right: 2px;
  padding: 0;
}
:where(.surfview-report-view) {
  white-space: nowrap;
}
:where(.surfview-report-swatch) {
  border: 1px solid currentColor;
  display: inline-block;
  height: 12px;
  margin-inline: 4px;
  vertical-align: middle;
  width: 12px;
}
:where(.surfview-report-opacity) {
  align-items: center;
  display: inline-flex;
  gap: 4px;
  white-space: nowrap;
}
:where(.surfview-report-opacity-slider) {
  width: var(--surfview-report-slider-width, 90px);
}
:where(.surfview-report-opacity-value) {
  display: inline-block;
  font-variant-numeric: tabular-nums;
  min-width: 4ch;
  text-align: end;
}
:where(.surfview-report-legend) {
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: 4px 8px;
  margin-left: auto;
}
:where(.surfview-report-legend-title) {
  white-space: nowrap;
}
:where(.surfview-report-colorbar) {
  padding-bottom: 13px;
  position: relative;
  width: var(--surfview-report-colorbar-width, 160px);
}
:where(.surfview-report-colorbar-ramp) {
  border: 1px solid var(--surfview-report-colorbar-border, rgba(17, 24, 39, 0.35));
  box-sizing: border-box;
  height: var(--surfview-report-colorbar-height, 10px);
  position: relative;
}
:where(.surfview-report-colorbar-mask) {
  background: repeating-linear-gradient(
    135deg,
    var(--surfview-report-mask, #e5e7eb) 0 3px,
    var(--surfview-report-mask-stripe, #9ca3af) 3px 4px
  );
  bottom: 0;
  position: absolute;
  top: 0;
}
:where(.surfview-report-colorbar-tick) {
  color: var(--surfview-report-muted, #475569);
  font-size: 10px;
  line-height: 1;
  position: absolute;
  top: 100%;
  transform: translateX(-50%);
  white-space: nowrap;
}
:where(.surfview-report-colorbar-tick)::before {
  background: var(--surfview-report-colorbar-border, rgba(17, 24, 39, 0.35));
  content: '';
  display: block;
  height: 3px;
  margin: 0 auto 1px;
  width: 1px;
}
:where(.surfview-report-colorbar-tick.is-start) {
  transform: none;
}
:where(.surfview-report-colorbar-tick.is-start)::before {
  margin-left: 0;
}
:where(.surfview-report-colorbar-tick.is-end) {
  transform: translateX(-100%);
}
:where(.surfview-report-colorbar-tick.is-end)::before {
  margin-right: 0;
}
:where(.surfview-report-feedback) {
  color: var(--surfview-report-error, #991b1b);
}
:where(.surfview-report-sr) {
  clip: rect(0 0 0 0);
  clip-path: inset(50%);
  height: 1px;
  overflow: hidden;
  position: absolute;
  white-space: nowrap;
  width: 1px;
}
:where(.surfview-status) {
  align-items: center;
  background: var(--surfview-report-bg, #f8fafc);
  box-sizing: border-box;
  color: var(--surfview-report-muted, #475569);
  display: flex;
  font: 13px/1.5 system-ui, sans-serif;
  inset: 0;
  justify-content: center;
  padding: 1rem;
  position: absolute;
  text-align: center;
}
:where(.surfview-status[data-state="error"]) {
  background: var(--surfview-report-error-bg, #fef2f2);
  color: var(--surfview-report-error, #991b1b);
}
:where(.surfview-report-controls, .surfview-mount) [hidden] {
  display: none;
}
`;

const installedDocuments = new WeakSet<Document>();

/**
 * Add {@link REPORT_STYLES} to `doc` once. Uses a constructed stylesheet where
 * supported (CSSOM, which a `style-src` Content-Security-Policy does not
 * block), otherwise a `<style data-surfview-report-styles>` element.
 */
export function installReportStyles(doc: Document = document): void {
  if (installedDocuments.has(doc)) return;
  if (doc.querySelector('style[data-surfview-report-styles]')) {
    installedDocuments.add(doc);
    return;
  }
  const view = doc.defaultView as (Window & typeof globalThis) | null;
  const Sheet = view?.CSSStyleSheet;
  if (Sheet && 'adoptedStyleSheets' in doc && typeof Sheet.prototype.replaceSync === 'function') {
    try {
      const sheet = new Sheet();
      sheet.replaceSync(REPORT_STYLES);
      doc.adoptedStyleSheets = [...doc.adoptedStyleSheets, sheet];
      installedDocuments.add(doc);
      return;
    } catch {
      // Fall back to a style element below.
    }
  }
  const style = doc.createElement('style');
  style.setAttribute('data-surfview-report-styles', '');
  style.textContent = REPORT_STYLES;
  (doc.head ?? doc.documentElement).appendChild(style);
  installedDocuments.add(doc);
}
