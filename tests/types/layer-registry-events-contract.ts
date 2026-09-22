import {
  BaseLayer,
  builtInLayerRegistry,
  ColorMap,
  DataLayer,
  DynamicEventEmitter,
  EventEmitter,
  createLayerFromConfig,
  tryCreateLayerFromConfig
} from '../../src';

const dataLayer = createLayerFromConfig({
  type: 'data',
  id: 'typed-data',
  data: new Float32Array([1])
});
const inferredDataLayer: DataLayer = dataLayer;
dataLayer.update({ range: [0, 1] });

// @ts-expect-error DataLayer does not accept temporal update fields.
dataLayer.update({ frames: [new Float32Array([1])] });
// @ts-expect-error The rgba discriminant requires interleaved data.
createLayerFromConfig({ type: 'rgba', id: 'missing-data' });
// @ts-expect-error Built-in creation is closed to registered discriminants.
createLayerFromConfig({ type: 'future-layer', id: 'future' });

const unknownResult = tryCreateLayerFromConfig({ type: 'future-layer', id: 'future' });
if (!unknownResult.ok) {
  const code: 'invalid-config' | 'unknown-type' | 'factory-error' = unknownResult.error.code;
  void code;
}

interface CustomLayerConfig {
  type: 'custom-gain';
  id: string;
  gain: number;
}

const customRegistry = builtInLayerRegistry.extend(
  'custom-gain',
  (config: CustomLayerConfig) => new BaseLayer(config.gain)
);
// @ts-expect-error The canonical registry is sealed; extensions are isolated.
builtInLayerRegistry.register('unsafe-global', (config: CustomLayerConfig) => new BaseLayer(config.gain));
const inferredCustomLayer: BaseLayer = customRegistry.create({
  type: 'custom-gain',
  id: 'custom',
  gain: 0x123456
});
// @ts-expect-error Third-party config inference retains required fields.
customRegistry.create({ type: 'custom-gain', id: 'missing-gain' });
// @ts-expect-error A registry remains closed to discriminants it has not registered.
customRegistry.create({ type: 'other', id: 'other', gain: 1 });

interface KnownEvents {
  ready: void;
  sample: { value: number };
}

const emitter = new EventEmitter<KnownEvents>();
emitter.emit('ready');
emitter.emit('sample', { value: 1 });
emitter.on('sample', event => event.value.toFixed());
// @ts-expect-error Known emitters reject misspelled event names.
emitter.emit('samples', { value: 1 });
// @ts-expect-error Void events reject payload tuples.
emitter.emit('ready', undefined);
// @ts-expect-error Known event payloads retain their declared shape.
emitter.emit('sample', { value: 'not-a-number' });

const colorMap = ColorMap.fromPreset('viridis');
colorMap.emit('rangeChanged', [0, 1]);
// @ts-expect-error ColorMap's known event vocabulary is closed.
colorMap.emit('rangeChange', [0, 1]);
// @ts-expect-error ColorMap range payloads require a two-number tuple.
colorMap.emit('rangeChanged', [0]);

const dynamic = new DynamicEventEmitter();
dynamic.emit('plugin:runtime-event', { provider: 'third-party' }, 42);

void inferredDataLayer;
void inferredCustomLayer;
