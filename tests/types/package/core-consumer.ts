import type {
  DataLayer,
  NeuroSurfaceViewer,
  NeuroSurfaceViewerConfig,
  ParcelConnectivityLayerConfig,
  SurfaceConfig
} from 'surfview';
import {
  BaseLayer,
  builtInLayerRegistry,
  DynamicEventEmitter,
  EventEmitter,
  createLayerFromConfig,
  tryCreateLayerFromConfig
} from 'surfview';

const viewerConfig: NeuroSurfaceViewerConfig = {};
const surfaceConfig: SurfaceConfig = {};
const resetThreshold: ParcelConnectivityLayerConfig = { threshold: null };

const packedDataLayer: DataLayer = createLayerFromConfig({
  type: 'data',
  id: 'packed-data',
  data: new Float32Array([1])
});
packedDataLayer.update({ threshold: [0, 0.5] });
// @ts-expect-error Packed update declarations reject fields from another layer kind.
packedDataLayer.update({ frames: [new Float32Array([1])] });
// @ts-expect-error Packed registry declarations require the built-in's data field.
createLayerFromConfig({ type: 'data', id: 'missing-data' });

interface PackedCustomConfig {
  type: 'packed-custom';
  id: string;
  color: number;
}
const packedRegistry = builtInLayerRegistry.extend(
  'packed-custom',
  (config: PackedCustomConfig) => new BaseLayer(config.color)
);
const packedCustom: BaseLayer = packedRegistry.create({
  type: 'packed-custom',
  id: 'custom',
  color: 0x123456
});
// @ts-expect-error Packed third-party registrations retain required config fields.
packedRegistry.create({ type: 'packed-custom', id: 'missing-color' });

const packedEvents = new EventEmitter<{ ready: void; sample: { value: number } }>();
packedEvents.emit('ready');
packedEvents.emit('sample', { value: 1 });
// @ts-expect-error Packed known event names are closed.
packedEvents.emit('samples', { value: 1 });
// @ts-expect-error Packed event payload tuples retain their declared shapes.
packedEvents.emit('sample', { value: 'wrong' });

const packedDynamicEvents = new DynamicEventEmitter();
packedDynamicEvents.emit('plugin:anything', { value: 'runtime-defined' }, 2);

const packedUnknown = tryCreateLayerFromConfig({ type: 'future', id: 'future' });
if (!packedUnknown.ok) {
  const packedFailureCode: 'invalid-config' | 'unknown-type' | 'factory-error' =
    packedUnknown.error.code;
  void packedFailureCode;
}

declare const viewer: NeuroSurfaceViewer;
viewer.onSurfaceClick = undefined;

// @ts-expect-error packed declarations reject explicit undefined for omitted viewer options.
const invalidViewerConfig: NeuroSurfaceViewerConfig = { initialZoom: undefined };
// @ts-expect-error packed declarations reject explicit undefined for omitted surface options.
const invalidSurfaceConfig: SurfaceConfig = { alpha: undefined };
// @ts-expect-error null is the parcel threshold reset value; undefined means omit the property.
const invalidThresholdReset: ParcelConnectivityLayerConfig = { threshold: undefined };

void viewerConfig;
void surfaceConfig;
void resetThreshold;
void packedDataLayer;
void packedCustom;
void invalidViewerConfig;
void invalidSurfaceConfig;
void invalidThresholdReset;
