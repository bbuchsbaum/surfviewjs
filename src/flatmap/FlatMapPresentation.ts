import { ColorMap, type RGBA } from '../ColorMap';
import { checkFraction } from '../geometry/GeometryError';

export interface FlatMapPresentation {
  colorMap: ColorMap;
  opacity?: number;
  showCoverage?: boolean;
  underlay?: readonly [number, number, number];
}

export function normalizeFlatMapPresentation(input: FlatMapPresentation): Required<FlatMapPresentation> {
  const underlay = input.underlay ?? [0.42, 0.46, 0.5];
  underlay.forEach(x => checkFraction(x, 'underlay channel'));
  return { colorMap: input.colorMap.clone(), opacity: checkFraction(input.opacity ?? 1, 'opacity'),
    showCoverage: input.showCoverage ?? true, underlay: [...underlay] };
}

/** Display sRGB, straight alpha; identical LUT-bin and threshold semantics to ColorMap. */
export function flatMapPixel(value: number, coverage: number, status: number, x: number, y: number,
  presentation: Required<FlatMapPresentation>, anatomy = 1): RGBA {
  if (status === 0) return [0, 0, 0, 0];
  let r = presentation.underlay[0] * anatomy, g = presentation.underlay[1] * anatomy, b = presentation.underlay[2] * anatomy;
  if (status === 4 && Number.isFinite(value)) {
    const color = presentation.colorMap.getColor(value), alpha = (color[3] ?? 1) * presentation.opacity;
    r = color[0] * alpha + r * (1 - alpha); g = color[1] * alpha + g * (1 - alpha); b = color[2] * alpha + b * (1 - alpha);
  }
  if (presentation.showCoverage && coverage < 1 - 1e-6 && (x + y) % 8 < 2) {
    r = r * 0.35 + 0.65; g = g * 0.35 + 0.65; b = b * 0.35 + 0.65;
  }
  return [r, g, b, 1];
}

export const FLATMAP_COLOR_GLSL = `
uniform sampler2D uField;
uniform sampler2D uPalette;
uniform float uPaletteSize;
uniform vec2 uRange;
uniform vec2 uThreshold;
uniform float uOpacity;
uniform bool uCoverage;
uniform vec3 uUnderlay;
uniform vec2 uResolution;
vec4 flatMapColor(vec2 chartUv, float anatomy) {
  // Nearest pixel centers are intentional: never blend a value with an invalid pixel.
  vec2 pixel = clamp(floor(chartUv * uResolution), vec2(0.), uResolution - 1.);
  vec4 field = texture2D(uField, (pixel + .5) / uResolution);
  if (field.b < .5) discard;
  vec3 result = uUnderlay * anatomy * field.a;
  bool hidden = uThreshold.x != uThreshold.y && field.r >= uThreshold.x && field.r <= uThreshold.y;
  if (field.b > 3.5 && !hidden) {
    float t = uRange.y == uRange.x ? 0. : clamp((field.r - uRange.x) / (uRange.y - uRange.x), 0., 1.);
    float bin = floor(t * (uPaletteSize - 1.));
    vec4 color = texture2D(uPalette, vec2((bin + .5) / uPaletteSize, .5));
    result = mix(result, color.rgb, color.a * uOpacity);
  }
  if (uCoverage && field.g < 1. - 1.e-6 && mod(pixel.x + pixel.y, 8.) < 2.) result = mix(result, vec3(1.), .65);
  return vec4(result, 1.);
}
`;
