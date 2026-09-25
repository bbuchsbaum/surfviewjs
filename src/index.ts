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
export { buildAtlasPlate } from './atlas/buildAtlasPlate';
export { buildParcelPuzzle } from './puzzle/buildParcelPuzzle';
export type { ParcelPuzzleInput, ParcelPuzzleGeometryOptions, ParcelPuzzleGeometry, ParcelPieceGeometry } from './puzzle/buildParcelPuzzle';
export { ParcelPuzzle } from './puzzle/ParcelPuzzle';
export type { ParcelPuzzleOptions, ParcelPuzzleSelection, ParcelPuzzleEvents } from './puzzle/ParcelPuzzle';
export { ParcelPuzzleView } from './puzzle/ParcelPuzzleView';
export type { ParcelPuzzleViewOptions, ParcelPuzzleViewEvents, ParcelDetailRenderer, ParcelDetailContext } from './puzzle/ParcelPuzzleView';
export { buildParcelMapMesh, flattenParcelMap, ParcelMapOptimizer, DEFAULT_PARCEL_MAP_PARAMETERS } from './puzzle/ParcelMap';
export type { ParcelMapMesh, ParcelMapParameters, ParcelMapMetrics, ParcelMapStep, ParcelMapSolveOptions } from './puzzle/ParcelMap';
export { AtlasPlateView, renderAtlasPlateSVG } from './atlas/AtlasPlateView';
export { emptyAtlasLayout, parseAtlasPlateLayout } from './atlas/atlasLayout';
export type { AtlasPlateLayout, AtlasPlatePresentation, AtlasViewport } from './atlas/atlasLayout';
export { parseAtlasFigureSpec, renderAtlasFigureSVG } from './atlas/AtlasFigure';
export type { AtlasFigureSpec, AtlasFigureSource } from './atlas/AtlasFigure';
export type { AtlasPlateStyle, AtlasPlateViewOptions } from './atlas/AtlasPlateView';
export type {
  AtlasPlate, AtlasPlateInput, AtlasPlateOptions, AtlasPlateOrientation,
  AtlasPlateRegion, AtlasPlateLabel, AtlasPlateProvenance, AtlasPoint, AtlasBounds
} from './atlas/types';
import { NeuroSurfaceViewer } from './NeuroSurfaceViewer';
import { SurfaceControls } from './SurfaceControls';
import {
  SurfaceGeometry,
  SurfaceGeometryError,
  validateSurfaceGeometryData,
  NeuroSurface,
  ColorMappedNeuroSurface,
  VertexColoredNeuroSurface
} from './classes';
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
import { DynamicEventEmitter, EventEmitter } from './EventEmitter';
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
import {
  builtInLayerRegistry,
  createLayerFromConfig,
  LayerConfigError,
  LayerRegistry,
  tryCreateLayerFromConfig
} from './LayerRegistry';
import { SubjectPackage, validateSubjectPackageManifest } from './SubjectPackage';
import { PluginHost } from './PluginHost';
import { FlatMapView } from './FlatMapView';
import { LinkedBrainWorkspace } from './LinkedBrainWorkspace';
import { ROIManager } from './roi';
import { AlignmentQAWorkspace } from './AlignmentQA';
import { STYLE_PRESETS, getStylePreset, listStylePresets, resolveFigureExportOptions, resolveStylePreset } from './StylePresets';
import { buildVertexAdjacency, MeshAdjacencyError } from './utils/meshAdjacency';
import { computeFDRThreshold, computeBonferroniThreshold, findClusters, filterClustersBySize, pToZ, tToZ } from './utils/statistics';
import { detectCapabilities } from './utils/capabilities';
import {
  compositeStraightRGBA,
  compositeStraightRGBABuffer,
  premultiplyStraightRGBA
} from './utils/rgbaCompositing';
import {
  MAX_DEVICE_PIXEL_RATIO,
  NumericValidationError
} from './utils/validation';
import {
  serialize,
  deserialize,
  encode,
  decode,
  migrateViewerState,
  migrateV1toV2,
  CURRENT_VERSION,
  SURFVIEW_EXPORT_SCHEMA,
  SURFVIEW_VERSION,
  exportScene,
  exportSceneJSON,
  exportSceneBlob,
  exportStaticHTML
} from './serialization';

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
import {
  createReportSceneControlTarget,
  layoutReportAnatomicalMeshes,
  mountSurfView,
  ReportSceneController,
  ReportSceneControlTarget
} from './report';
import {
  SurfViewControlSession,
  ViewerControlTarget,
  createManagedViewerControlSession,
  createSurfViewControlSession,
  createViewerControlTarget
} from './controls';

export {
  NeuroSurfaceViewer,
  SurfaceControls,
  SurfaceGeometry,
  SurfaceGeometryError,
  validateSurfaceGeometryData,
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
  DynamicEventEmitter,
  LaplacianSmoothing,
  THREE,
  debugLog,
  setDebug,
  BoundingBoxHelper,
  AnnotationManager,
  detectCapabilities,
  compositeStraightRGBA,
  compositeStraightRGBABuffer,
  premultiplyStraightRGBA,
  MAX_DEVICE_PIXEL_RATIO,
  NumericValidationError,
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
  layoutReportAnatomicalMeshes,
  StatisticalMapLayer,
  ParcelValueLayer,
  ParcelConnectivityLayer,
  ConnectivityLayer,
  LayerRegistry,
  LayerConfigError,
  builtInLayerRegistry,
  createLayerFromConfig,
  tryCreateLayerFromConfig,
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
  MeshAdjacencyError,
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
  migrateViewerState,
  migrateV1toV2,
  CURRENT_VERSION,
  SURFVIEW_EXPORT_SCHEMA,
  SURFVIEW_VERSION,
  exportScene,
  exportSceneJSON,
  exportSceneBlob,
  exportStaticHTML,
  SurfViewControlSession,
  createManagedViewerControlSession,
  createSurfViewControlSession,
  ViewerControlTarget,
  createViewerControlTarget,
  ReportSceneController,
  ReportSceneControlTarget,
  createReportSceneControlTarget
};

export type {
  RegisteredLayerConfig,
  BuiltInLayerConfigBase,
  BaseLayerFactoryConfig,
  RGBALayerFactoryConfig,
  DataLayerFactoryConfig,
  OutlineLayerFactoryConfig,
  LabelLayerFactoryConfig,
  TwoDataLayerFactoryConfig,
  TemporalLayerFactoryConfig,
  VolumeLayerFactoryConfig,
  CurvatureLayerFactoryConfig,
  StatisticalLayerFactoryConfig,
  ConnectivityLayerFactoryConfig,
  BuiltInLayerConfigMap,
  BuiltInLayerMap,
  BuiltInLayerType,
  BuiltInLayerRegistryEntries,
  BuiltInLayerConfig,
  BuiltInLayer,
  BuiltInLayerFor,
  LayerCreationFailureCode,
  LayerCreationResult,
  LayerRegistryEntry,
  LayerFactory,
  ReadonlyLayerRegistry,
  RegistryType,
  RegistryConfigUnion,
  RegistryLayer,
  RegistryLayerUnion,
  RegistryLayerForConfig
} from './LayerRegistry';

export type { Color, ColorArray, ColorMapOptions, RGB, RGBA } from './ColorMap';
export type {
  ColorMap2DPreset,
  ColorMap2DOptions,
  RGBA as ColorMap2DRGBA
} from './ColorMap2D';

export type {
  ColorMapEventMap
} from './ColorMap';

export type {
  NumericValidationErrorCode,
  FiniteNumberDomain
} from './utils/validation';

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
  StatisticalMapLayerUpdateData,
  DualThresholdConfig,
  VertexStatInfo,
  StatType,
  CorrectionMethod
} from './layers/StatisticalMapLayer';

export type {
  ParcelValueLayerConfig,
  ParcelValueLayerUpdateData
} from './layers/ParcelValueLayer';

export type {
  ParcelConnectivityLayerConfig,
  ParcelConnectivityLayerUpdate,
  ParcelConnectivityAlphaMode
} from './layers/ParcelConnectivityLayer';

export type {
  BlendMode,
  LayerConfig,
  DataLayerConfig,
  TwoDataLayerConfig,
  LayerUpdateData,
  RGBALayerUpdateData,
  DataLayerUpdateData,
  TwoDataLayerUpdateData,
  BaseLayerUpdateData,
  LabelLayerOptions,
  LabelLayerUpdateData,
  LayerChangeSet,
  LayerRole,
  LayerPinnedPosition,
  LayerOrderConstraints,
  LayerOrderDescriptor,
  LayerOrderFailureCode,
  LayerOrderResult,
  LayerPresentation,
  LayerHistogram,
  LayerDataSummary,
  LayerHistogramOptions,
  LayerDataSummaryOptions,
  VolumeProjectionMode,
  VolumeSamplingMode,
  VolumeProjectionQuality,
  RibbonReducer,
  RibbonSamplingConfig,
  VolumeProjectionLayerConfig,
  VolumeProjectionLayerUpdateData
} from './layers';

export type {
  MultiLayerSurfaceConfig,
  LayerUpdate,
  ClearLayersOptions
} from './MultiLayerNeuroSurface';

export type {
  EasingFunction,
  MorphTargetConfig,
  MorphAnimationOptions,
  MorphableSurfaceConfig
} from './MorphableSurface';

export type { SurfaceShadingOptions } from './surface/SurfaceShading';

export type { LabelDefinition } from './LabeledNeuroSurface';
export type { SurfaceDefinition, SurfaceType } from './SurfaceFactory';
export type { SurfaceSetConfig } from './SurfaceSet';
export type { VariantTransitionOptions } from './VariantSurface';
export type { SurfaceControlsConfig } from './SurfaceControls';
export type { OutlineLayerOptions, OutlineLayerUpdate } from './OutlineLayer';
export type { AnnotationOptions, AnnotationRecord } from './annotations';
export type { CrosshairMode, CrosshairOptions } from './CrosshairManager';
export type { PickInfo } from './utils/Picking';
export type { GPUPickResult } from './utils/GPUPicker';
export type { ClipAxis, ClipPlaneConfig } from './utils/ClipPlane';
export type { ViewerCapabilities } from './utils/capabilities';
export type {
  VolumeProjectionMaterialConfig,
  VolumeProjectionMaterialOptions
} from './materials/VolumeProjectionMaterial';
export type { VolumeProjectedSurfaceOptions } from './surfaces/VolumeProjectedSurface';
export type { VolumeTexture3DOptions } from './textures/VolumeTexture3D';
export type { CurvatureConfig, CurvatureLayerUpdateData } from './layers/CurvatureLayer';

export {
  ANATOMICAL_VIEWS,
  getAnatomicalViewAxes,
  normalizeAnatomicalHemisphere
} from './AnatomicalView';

export { NO_INSPECTION_SELECTION } from './Inspection';

export type {
  InspectionSelection,
  NoInspectionSelection,
  VertexInspectionSelection,
  ParcelInspectionSelection,
  InspectionSelectionOptions,
  InspectionSelectionFailureCode,
  InspectionSelectionResult,
  InspectionSelectionChangedEvent,
  VertexInspection,
  VertexInspectionLayerValue,
  VertexInspectionParcel,
  VertexInspectionAtlas
} from './Inspection';

export type {
  AnatomicalView,
  AnatomicalHemisphere,
  AnatomicalViewLayout,
  AnatomicalViewAxes,
  Vector3Tuple,
  AnatomicalViewOptions,
  SingleAnatomicalViewOptions,
  PairedAnatomicalViewOptions,
  AnatomicalViewCapabilities,
  AnatomicalViewFailureCode,
  AnatomicalViewResult,
  AnatomicalViewResetResult,
  AnatomicalViewChangedEvent,
  BilateralSurfaceGroup,
  BilateralSurfaceGroupFailureCode,
  BilateralSurfaceGroupResult,
  BilateralSurfaceGroupRemovalReason,
  BilateralSurfaceGroupRegisteredEvent,
  BilateralSurfaceGroupRemovedEvent
} from './AnatomicalView';

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
  PackageAssetRef,
  SubjectHemisphere,
  ValidationSeverity,
  SceneLayerSourceType,
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
  SurfViewSceneView,
  ReportAnatomicalMesh,
  ReportSceneDisposingListener,
  ReportSceneControllerOptions,
  ReportSceneControllerState,
  ReportSceneMutationListener,
  ReportSceneMutationPhase,
  ReportSceneControlTargetOptions,
  ReportLayout,
  ReportBrainView,
  ReportObliqueAngle,
  ReportFitInsets
} from './report';

export type {
  ControlDomain,
  EventListener,
  EventPayloadArgs,
  EventArgsFor,
  EventType,
  TypedEventListener,
  UnsubscribeFn,
  ViewerStateChangedEvent,
  LayerReorderedEvent,
  SurfaceLayerReorderedEvent,
  SurfaceEventMap,
  SurfaceEventType,
  ViewerEventMap,
  ViewerEventType,
  ViewerEventListener
} from './events';

export type {
  ControlJsonPrimitive,
  ControlJsonObject,
  ControlJsonValue,
  CapabilityAvailability,
  ControlOptionDescriptor,
  NumericRangeControlDescriptor,
  HistogramControlDescriptor,
  LayerDataSummaryControlDescriptor,
  ScalarMappingControls,
  BivariateMappingControls,
  TemporalControls,
  ParcelControls,
  OutlineControls,
  LayerColorPreviewDescriptor,
  LayerControlDescriptor,
  SurfaceControlDescriptor,
  AnatomicalViewTargetRef,
  AnatomicalViewTargetDescriptor,
  CurrentAnatomicalViewDescriptor,
  ViewControlDescriptor,
  SelectionControlDescriptor,
  FigurePresetControlDescriptor,
  FigureControlDescriptor,
  ExclusiveMapCapability,
  SurfViewControlCapabilities,
  SurfViewControlSnapshot,
  ControlCommandFailureCode,
  ControlCommandFailure,
  ControlCommandSuccess,
  ControlCommandResult,
  ControlQueryResult,
  SetAnatomicalViewRequest,
  LayerControlAddress,
  ScalarMappingUpdate,
  FigureExportRequest,
  FigureExportResult,
  SurfViewControlTargetCommands,
  SurfViewControlSnapshotListener,
  SurfViewControlSubscription,
  SurfViewControlTarget,
  SurfViewControlSectionId,
  SurfViewControlSessionState,
  SurfViewControlSessionOptions,
  SurfViewControlFocusSnapshot,
  SurfViewControlSessionSnapshot,
  SurfViewControlSessionSnapshotListener,
  ManagedViewerControlSessionOptions,
  ViewerControlTargetOptions
} from './controls';

export type {
  NeuroSurfaceViewerConfig,
  ResolvedNeuroSurfaceViewerConfig,
  ParcelFocusOptions,
  ViewerFigureBackground,
  Viewpoint,
  ViewpointConfig,
  ViewpointState
} from './NeuroSurfaceViewer';

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

// Export geometry and mesh adjacency types
export type {
  SurfaceConfig,
  ResolvedSurfaceConfig,
  SurfaceGeometryErrorCode
} from './classes';
export type { MeshAdjacency, MeshAdjacencyErrorCode } from './utils/meshAdjacency';

// Export statistics result types
export type { FDRResult, BonferroniResult, ClusterResult } from './utils/statistics';
export type { StraightRGBA } from './utils/rgbaCompositing';
export type {
  GPUCompositorCapacity,
  GPUCompositorUpdateStats
} from './GPULayerCompositor';

// Export serialization types
export type {
  ViewerState,
  ViewerStateV1,
  ViewerStateV2,
  CameraState,
  LightingState,
  ViewerConfigState,
  ClipPlaneState as SerializedClipPlaneState,
  LayerState,
  SurfaceStateV1,
  SurfaceState,
  SurfaceGroupState,
  CrosshairState as SerializedCrosshairState,
  SerializedTimelineState,
  SelectionState,
  RestorationIssueCode,
  RestorationIssue,
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
