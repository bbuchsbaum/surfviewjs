import { ColorMap, createLayerFromConfig, projectRibbonVolume, VolumeProjectionLayer } from '../../src';
import type { ProjectRibbonVolumeOptions, RibbonProjectionSurface, VolumeDescriptor } from '../../src';
declare const volume: VolumeDescriptor;
const surface: RibbonProjectionSurface = { white:[0,0,0], pial:[0,0,2] };
const options: ProjectRibbonVolumeOptions = { steps:7, interpolation:'nearest', reducer:'mean' };
const result = projectRibbonVolume(volume, surface, options);
const values: Float32Array = result.values;
const counts: Uint32Array = result.validSamples;
// @ts-expect-error ribbon thickness comes from its paired endpoints
projectRibbonVolume(volume, surface, { depthMm:[0,1] });
const layer = new VolumeProjectionLayer('custom', [1], [1,1,1], { colormap:['#0000ff','#ff0000'] });
layer.update({ colorMap: ColorMap.fromArray([[1,0,0,0.5]]) });
layer.setColormap([[0,0,1],[1,0,0]]);
createLayerFromConfig({ type:'volume', id:'custom', volumeData:[1], dims:[1,1,1], colormap:ColorMap.fromArray(['#ffffff']) });
void values; void counts;
