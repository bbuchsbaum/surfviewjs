/**
 * Minimal CSS reset for embedding neurosurface in iframes/htmlwidgets.
 */
export const embedStyles = `
.neurosurface-root {
  margin: 0;
  padding: 0;
  position: relative;
}
.neurosurface-root canvas {
  display: block;
}
`;

export function applyEmbedStyles(element?: HTMLElement): void {
  if (!element || typeof window === 'undefined' || !window.document) return;
  element.classList.add('neurosurface-root');
  const styleId = 'neurosurface-embed-styles';
  if (!document.getElementById(styleId)) {
    const styleEl = document.createElement('style');
    styleEl.id = styleId;
    styleEl.textContent = embedStyles;
    document.head.appendChild(styleEl);
  }
}
