/**
 * SurfViewJS - Neuroimaging Surface Visualization Library
 *
 * A comprehensive Three.js-based library for visualizing brain surfaces
 * with support for multiple data layers, colormaps, and interactive controls.
 *
 * @module surfviewjs
 * @see {@link https://github.com/bbuchsbaum/surfviewjs} for documentation
 * @license MIT
 */

import * as THREE from 'three';
import { NeuroSurfaceViewer } from './NeuroSurfaceViewer';
import { SurfaceControls } from './SurfaceControls';
import { SurfaceGeometry, NeuroSurface, ColorMappedNeuroSurface, VertexColoredNeuroSurface } from './classes';
import { MultiLayerNeuroSurface } from './MultiLayerNeuroSurface';
import { VariantSurface } from './VariantSurface';
import { MorphableSurface, Easing } from './MorphableSurface';
import { SurfaceSet } from './SurfaceSet';
import { LabeledNeuroSurface } from './LabeledNeuroSurface';
import { SurfaceFactory } from './SurfaceFactory';
import { Layer, RGBALayer, DataLayer, TwoDataLayer, BaseLayer, LabelLayer, LayerStack, VolumeProjectionLayer } from './layers';
import ColorMap2D from './ColorMap2D';
import { OutlineLayer } from './OutlineLayer';
import { CurvatureLayer } from './layers/CurvatureLayer';
import { GPULayerCompositor } from './GPULayerCompositor';
import { computeMeanCurvature, normalizeCurvature, curvatureToGrayscale } from './utils/curvature';
import { ClipPlane, ClipPlaneSet } from './utils/ClipPlane';
import { debugLog, setDebug } from './debug';
import ColorMap from './ColorMap';
import { EventEmitter } from './EventEmitter';
import { LaplacianSmoothing } from './utils/LaplacianSmoothing';
import { BoundingBoxHelper } from './utils/BoundingBox';
import { AnnotationManager } from './annotations';
import { embedStyles, applyEmbedStyles } from './embedStyles';
import { computePickInfo } from './utils/Picking';
import { GPUPicker } from './utils/GPUPicker';
import { CrosshairManager } from './CrosshairManager';
import { TemporalDataLayer, TimelineController, SparklineOverlay } from './temporal';
import { StatisticalMapLayer } from './layers/StatisticalMapLayer';
import { ParcelValueLayer } from './layers/ParcelValueLayer';
import { ParcelConnectivityLayer } from './layers/ParcelConnectivityLayer';
import { ConnectivityLayer } from './ConnectivityLayer';
import { SubjectPackage, validateSubjectPackageManifest } from './SubjectPackage';
import { PluginHost } from './PluginHost';
import { FlatMapView } from './FlatMapView';
import { LinkedBrainWorkspace } from './LinkedBrainWorkspace';
import { ROIManager } from './roi';
import { AlignmentQAWorkspace } from './AlignmentQA';
import { STYLE_PRESETS, getStylePreset, listStylePresets, resolveFigureExportOptions, resolveStylePreset } from './StylePresets';
import { buildVertexAdjacency } from './utils/meshAdjacency';
import { computeFDRThreshold, computeBonferroniThreshold, findClusters, filterClustersBySize, pToZ, tToZ } from './utils/statistics';
import { detectCapabilities } from './utils/capabilities';
import {
  serialize,
  deserialize,
  encode,
  decode,
  CURRENT_VERSION,
  SURFVIEW_EXPORT_SCHEMA,
  SURFVIEW_VERSION,
  exportScene,
  exportSceneJSON,
  exportSceneBlob,
  exportStaticHTML
} from './serialization';

// Register TemporalDataLayer with Layer factory to avoid circular dependency
Layer.registerTemporalLayer(TemporalDataLayer);
import { NoopNeuroSurfaceViewer, hasDOM } from './NoopNeuroSurfaceViewer';
import { VolumeTexture3D } from './textures/VolumeTexture3D';
import { VolumeProjectionMaterial } from './materials/VolumeProjectionMaterial';
import { VolumeProjectedSurface } from './surfaces/VolumeProjectedSurface';
import { ParcelSurface } from './surfaces/ParcelSurface';
import { createColormapTexture } from './textures/createColormapTexture';
import {
  SURFVIEW_SCENE_SCHEMA,
  SceneManifestError,
  validateSceneManifest,
  createSceneAsset,
  loadSceneAsset
} from './scene';
import { mountSurfView } from './report';

export {
  NeuroSurfaceViewer,
  SurfaceControls,
  SurfaceGeometry,
  NeuroSurface,
  ColorMappedNeuroSurface,
  VertexColoredNeuroSurface,
  MultiLayerNeuroSurface,
  VariantSurface,
  MorphableSurface,
  Easing,
  SurfaceSet,
  LabeledNeuroSurface,
  Layer,
  RGBALayer,
  DataLayer,
  TwoDataLayer,
  BaseLayer,
  LabelLayer,
  LayerStack,
  VolumeProjectionLayer,
  ColorMap2D,
  OutlineLayer,
  CurvatureLayer,
  GPULayerCompositor,
  computeMeanCurvature,
  normalizeCurvature,
  curvatureToGrayscale,
  ClipPlane,
  ClipPlaneSet,
  ColorMap,
  EventEmitter,
  LaplacianSmoothing,
  THREE,
  debugLog,
  setDebug,
  BoundingBoxHelper,
  AnnotationManager,
  detectCapabilities,
  embedStyles,
  applyEmbedStyles,
  computePickInfo,
  SurfaceFactory,
  NoopNeuroSurfaceViewer,
  hasDOM,
  GPUPicker,
  CrosshairManager,
  TemporalDataLayer,
  TimelineController,
  SparklineOverlay,
  VolumeTexture3D,
  VolumeProjectionMaterial,
  VolumeProjectedSurface,
  ParcelSurface,
  createColormapTexture,
  SURFVIEW_SCENE_SCHEMA,
  SceneManifestError,
  validateSceneManifest,
  createSceneAsset,
  loadSceneAsset,
  mountSurfView,
  StatisticalMapLayer,
  ParcelValueLayer,
  ParcelConnectivityLayer,
  ConnectivityLayer,
  SubjectPackage,
  validateSubjectPackageManifest,
  PluginHost,
  FlatMapView,
  LinkedBrainWorkspace,
  ROIManager,
  AlignmentQAWorkspace,
  STYLE_PRESETS,
  getStylePreset,
  listStylePresets,
  resolveFigureExportOptions,
  resolveStylePreset,
  buildVertexAdjacency,
  computeFDRThreshold,
  computeBonferroniThreshold,
  findClusters,
  filterClustersBySize,
  pToZ,
  tToZ,
  serialize,
  deserialize,
  encode,
  decode,
  CURRENT_VERSION,
  SURFVIEW_EXPORT_SCHEMA,
  SURFVIEW_VERSION,
  exportScene,
  exportSceneJSON,
  exportSceneBlob,
  exportStaticHTML
};

// Export temporal types for TypeScript consumers
export type {
  TemporalDataConfig,
  FactorDescriptor,
  TimelineState,
  TimelineEvent,
  TimelineEventMap,
  LoopMode,
  SparklineOptions
} from './temporal';

// Export statistical map types for TypeScript consumers
export type {
  StatisticalMapLayerConfig,
  DualThresholdConfig,
  VertexStatInfo,
  StatType
} from './layers/StatisticalMapLayer';

export type {
  ParcelConnectivityLayerConfig,
  ParcelConnectivityLayerUpdate,
  ParcelConnectivityAlphaMode
} from './layers/ParcelConnectivityLayer';

export type {
  VolumeProjectionMode,
  VolumeSamplingMode,
  VolumeProjectionQuality,
  RibbonReducer,
  RibbonSamplingConfig,
  VolumeProjectionLayerConfig,
  VolumeProjectionLayerUpdateData
} from './layers';

export type {
  RoiDrawMode,
  RoiPoint,
  RoiProvenance,
  VertexROI,
  CreateROIOptions,
  PolygonVertexSource,
  RoiSVGOptions,
  RoiLabelExportOptions,
  RoiManifestExportOptions
} from './roi';

export {
  selectVerticesInPolygon,
  createROIFromPolygon,
  roiToLabelArray,
  roiToSVG,
  roiToLabelGIFTI,
  roiToSubjectPackageRoi,
  cloneROI
} from './roi';

export type {
  SubjectPackageManifest,
  SubjectPackageSoftware,
  SubjectPackageProvenance,
  SurfaceSetManifest,
  SurfaceVariantManifest,
  MetricManifest,
  ParcellationManifest,
  RoiManifest,
  TransformManifest,
  VolumeManifest,
  SceneManifest,
  SceneLayerManifest,
  SceneSurfaceManifest,
  SubjectPackageValidationIssue,
  SubjectPackageValidationReport,
  SubjectPackageOptions,
  SubjectPackageLoadOptions
} from './SubjectPackage';

export type {
  SurfViewStylePresetName,
  LabelDensity,
  StylePresetBackground,
  StylePresetLighting,
  StylePresetMaterial,
  StylePresetCurvature,
  StylePresetROI,
  StylePresetAnnotation,
  StylePresetColormaps,
  StylePresetFigure,
  SurfViewStylePreset,
  FigureExportLabel,
  FigureExportOptions,
  ResolvedFigureExportOptions
} from './StylePresets';

export type {
  SceneAssetDescriptor,
  SceneAssetDType,
  SceneAssetRole,
  SceneGeometryManifest,
  SceneHemisphere,
  SceneLayerLegend,
  SurfViewSceneLayerManifest,
  SceneLayerValuesManifest,
  SurfViewSceneManifest,
  CreateSceneAssetOptions,
  LoadSceneAssetOptions,
  SceneTypedArray
} from './scene';

export type {
  MountSurfViewOptions,
  SurfViewMountHandle,
  SurfViewSceneView
} from './report';

export type {
  PluginHostViewer,
  ViewerPluginContext,
  PluginTeardown,
  ViewerPlugin,
  RegisterPluginOptions,
  PluginRegistration
} from './PluginHost';

export type {
  FlatMapGeometryInput,
  FlatMapViewOptions,
  FlatMapVertexEvent,
  FlatMapClickEvent,
  FlatMapSelectionEvent,
  FlatMapROIEvent,
  FlatMapROIDrawingOptions,
  FlatMapEventMap
} from './FlatMapView';

export type {
  LinkOptions,
  LinkedViewerLike,
  LinkedTimelineLike,
  LinkedBrainWorkspaceOptions
} from './LinkedBrainWorkspace';

export type {
  AlignmentSliceAxis,
  AlignmentVolume,
  AlignmentSurface,
  AlignmentTransform,
  AlignmentQAConfig,
  SurfaceDistanceSummary,
  EdgeAgreementSummary,
  DropoutSummary,
  AlignmentQAMetrics,
  AlignmentQAReport
} from './AlignmentQA';

export {
  computeAlignmentQAMetrics,
  createAlignmentQAReport
} from './AlignmentQA';

// Export connectivity layer types for TypeScript consumers
export type {
  ConnectivityEdge,
  ConnectivityLayerConfig,
  ConnectivityLayerUpdate,
  RenderMode,
  CSRData
} from './ConnectivityLayer';

// Export mesh adjacency types
export type { MeshAdjacency } from './utils/meshAdjacency';

// Export statistics result types
export type { FDRResult, BonferroniResult, ClusterResult } from './utils/statistics';

// Export serialization types
export type {
  ViewerStateV1,
  CameraState,
  LightingState,
  ViewerConfigState,
  ClipPlaneState as SerializedClipPlaneState,
  LayerState,
  SurfaceState,
  CrosshairState as SerializedCrosshairState,
  SelectionState,
  RestorationReport,
  SceneAssetType,
  SceneAssetManifest,
  SceneExportProvenance,
  SceneExportManifest,
  SceneExportOptions,
  StaticHTMLExportOptions
} from './serialization';

// Export loaders
export * from './loaders';

// Export parcel data representation types/utilities
export * from './parcellation';

// Export graph-native visualization primitives
export * from './graphVisual';
export * from './surfaces/ParcelSurface';

// Export event types
export * from './events';
