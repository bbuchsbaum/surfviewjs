// React-specific public entry. React remains an optional peer and is never
// imported by the core `surfview` entry.
export * from './index';
export {
  default as NeuroSurfaceViewerReact,
  SurfaceHelpers
} from './react/NeuroSurfaceViewer';
export type {
  NeuroSurfaceViewerHandle,
  NeuroSurfaceViewerReactProps
} from './react/NeuroSurfaceViewer';
export { useNeuroSurface } from './react/useNeuroSurface';
export type {
  BackendLayerUpdate,
  BaseLayerData,
  ColorMappedSurfaceData,
  ManagedLayerState,
  ManagedLayerType,
  ManagedLayerUpdate,
  ManagedSurfaceState,
  ManagedSurfaceType,
  MultiLayerSurfaceData,
  NeuroSurfaceData,
  NeuroSurfaceLayerData,
  NeuroSurfaceViewerRef,
  RGBALayerData,
  ScalarLayerData,
  UseNeuroSurfaceOptions,
  UseNeuroSurfaceResult,
  VertexColoredSurfaceData
} from './react/useNeuroSurface';
