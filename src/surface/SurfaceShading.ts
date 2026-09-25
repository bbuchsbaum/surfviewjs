import type * as THREE from 'three';

/**
 * Fragment-level surface shading shared by CPU-composited surfaces.
 *
 * - Threshold edges: the top thresholded data layer is not baked into vertex
 *   colours. Its colour and a signed distance to the mask travel as vertex
 *   attributes, so the shader draws the threshold as an anti-aliased isoline
 *   (width from screen-space derivatives) rather than a per-vertex staircase.
 * - Threshold outline: an optional darker band just inside that isoline.
 * - Silhouette darkening: grazing-angle darkening that separates overlapping
 *   hemispheres and gives the cortex a solid, drawn edge.
 */
export interface SurfaceShadingOptions {
  /** Draw thresholded data layers with per-fragment isolines. Default true. */
  thresholdEdges?: boolean;
  /** Outline band width in screen-space derivative units (0 disables). Default 0. */
  thresholdOutline?: number;
  /** Colour multiplier inside the outline band (0 black, 1 invisible). Default 0.55. */
  thresholdOutlineShade?: number;
  /** Darkening at grazing angles (0 none, 1 black silhouette). Default 0. */
  silhouetteDarkening?: number;
  /**
   * Share of the overlay colour emitted rather than lit (0-1). Full diffuse
   * shading muddies bright colormap ends (yellow reads olive on shadowed
   * slopes); a partial emissive term keeps overlay hues true. Default 0.
   */
  overlayEmission?: number;
}

export interface SurfaceShadingUniforms {
  surfviewEdgeEnabled: { value: number };
  surfviewOutlineWidth: { value: number };
  surfviewOutlineShade: { value: number };
  surfviewSilhouette: { value: number };
  surfviewEmission: { value: number };
}

export const SURFACE_OVERLAY_ATTRIBUTE = 'surfviewOverlay';
export const SURFACE_EDGE_ATTRIBUTE = 'surfviewEdge';

function finiteIn(value: number | undefined, fallback: number, name: string, max = Infinity): number {
  if (value === undefined) return fallback;
  if (!Number.isFinite(value) || value < 0 || value > max) {
    throw new RangeError(`${name} must be a finite number between 0 and ${max}`);
  }
  return value;
}

export function createSurfaceShadingUniforms(options: SurfaceShadingOptions = {}): SurfaceShadingUniforms {
  const uniforms: SurfaceShadingUniforms = {
    surfviewEdgeEnabled: { value: 0 },
    surfviewOutlineWidth: { value: 0 },
    surfviewOutlineShade: { value: 0.55 },
    surfviewSilhouette: { value: 0 },
    surfviewEmission: { value: 0 }
  };
  updateSurfaceShadingUniforms(uniforms, options);
  return uniforms;
}

export function updateSurfaceShadingUniforms(
  uniforms: SurfaceShadingUniforms,
  options: SurfaceShadingOptions
): void {
  if (options.thresholdOutline !== undefined) {
    uniforms.surfviewOutlineWidth.value = finiteIn(options.thresholdOutline, 0, 'thresholdOutline', 20);
  }
  if (options.thresholdOutlineShade !== undefined) {
    uniforms.surfviewOutlineShade.value = finiteIn(options.thresholdOutlineShade, 0.55, 'thresholdOutlineShade', 1);
  }
  if (options.overlayEmission !== undefined) {
    uniforms.surfviewEmission.value = finiteIn(options.overlayEmission, 0, 'overlayEmission', 1);
  }
  if (options.silhouetteDarkening !== undefined) {
    uniforms.surfviewSilhouette.value = finiteIn(options.silhouetteDarkening, 0, 'silhouetteDarkening', 1);
  }
}

const VERTEX_DECLARATIONS = `
attribute vec4 ${SURFACE_OVERLAY_ATTRIBUTE};
attribute float ${SURFACE_EDGE_ATTRIBUTE};
varying vec4 vSurfviewOverlay;
varying float vSurfviewEdge;
`;

const FRAGMENT_DECLARATIONS = `
uniform float surfviewEdgeEnabled;
uniform float surfviewOutlineWidth;
uniform float surfviewOutlineShade;
uniform float surfviewSilhouette;
uniform float surfviewEmission;
varying vec4 vSurfviewOverlay;
varying float vSurfviewEdge;
`;

const FRAGMENT_COLOR = `
vec3 surfviewGlow = vec3( 0.0 );
#if defined( USE_COLOR_ALPHA )
  vec4 surfviewBase = vColor;
#elif defined( USE_COLOR )
  vec4 surfviewBase = vec4( vColor, 1.0 );
#else
  vec4 surfviewBase = vec4( 1.0 );
#endif
if ( surfviewEdgeEnabled > 0.5 ) {
  float surfviewWidth = max( fwidth( vSurfviewEdge ), 1e-6 );
  float surfviewInside = smoothstep( -0.5 * surfviewWidth, 0.5 * surfviewWidth, vSurfviewEdge );
  vec3 surfviewFill = vSurfviewOverlay.rgb;
  if ( surfviewOutlineWidth > 0.0 ) {
    float surfviewBand = 1.0 - smoothstep(
      surfviewOutlineWidth * surfviewWidth,
      ( surfviewOutlineWidth + 1.0 ) * surfviewWidth,
      vSurfviewEdge
    );
    // Darken light fills fully and dark fills (saturated blues) less, so the
    // rim reads as one weight across the colormap.
    float surfviewLuma = dot( surfviewFill, vec3( 0.2126, 0.7152, 0.0722 ) );
    float surfviewShade = mix( mix( 1.0, surfviewOutlineShade, 0.45 ), surfviewOutlineShade, clamp( surfviewLuma * 1.6, 0.0, 1.0 ) );
    surfviewFill *= mix( 1.0, surfviewShade, surfviewBand );
  }
  float surfviewAlpha = surfviewInside * clamp( vSurfviewOverlay.a, 0.0, 1.0 );
  surfviewBase.rgb = mix( surfviewBase.rgb, surfviewFill * ( 1.0 - surfviewEmission ), surfviewAlpha );
  surfviewGlow = surfviewFill * surfviewEmission * surfviewAlpha;
}
diffuseColor *= surfviewBase;
`;

const FRAGMENT_EMISSIVE = `
#include <emissivemap_fragment>
totalEmissiveRadiance += surfviewGlow;
`;

const FRAGMENT_SILHOUETTE = `
if ( surfviewSilhouette > 0.0 ) {
  float surfviewFacing = clamp( abs( dot( normalize( normal ), normalize( vViewPosition ) ) ), 0.0, 1.0 );
  outgoingLight *= mix( 1.0, 1.0 - surfviewSilhouette, pow( 1.0 - surfviewFacing, 2.5 ) );
}
#include <opaque_fragment>
`;

/**
 * Patch a Phong/Lambert/Standard material in place. Existing onBeforeCompile
 * hooks run first, so other shader patches compose with this one.
 */
export function installSurfaceShading(
  material: THREE.Material,
  uniforms: SurfaceShadingUniforms
): void {
  const userData = (material as THREE.Material & { userData: Record<string, unknown> }).userData;
  if (userData.surfviewShading) return;
  userData.surfviewShading = true;
  const previous = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    previous?.call(material, shader, renderer);
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${VERTEX_DECLARATIONS}`)
      .replace(
        '#include <color_vertex>',
        `#include <color_vertex>\nvSurfviewOverlay = ${SURFACE_OVERLAY_ATTRIBUTE};\nvSurfviewEdge = ${SURFACE_EDGE_ATTRIBUTE};`
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${FRAGMENT_DECLARATIONS}`)
      .replace('#include <color_fragment>', FRAGMENT_COLOR)
      .replace('#include <emissivemap_fragment>', FRAGMENT_EMISSIVE)
      .replace('#include <opaque_fragment>', FRAGMENT_SILHOUETTE);
  };
  const previousKey = material.customProgramCacheKey;
  material.customProgramCacheKey = () =>
    `${previousKey ? previousKey.call(material) : ''}|surfview-shading-v2`;
  material.needsUpdate = true;
}
