// React-specific exports
// This file should be used when React is available

// Re-export everything from the main index
export * from './index';

// Export React components
export { default as NeuroSurfaceViewerReact, SurfaceHelpers } from './react/NeuroSurfaceViewer.jsx';
export { useNeuroSurface } from './react/useNeuroSurface.js';