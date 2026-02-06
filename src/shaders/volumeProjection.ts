export const VOLUME_PROJECTION_VERTEX_SHADER = `
precision highp float;
precision highp sampler3D;

uniform sampler3D uVolumeSampler;
uniform mat4 uWorldToIJK;
uniform vec3 uVolumeDims;
uniform float uFillValue;

out float vValue;
out float vInBounds;
out vec3 vNormalView;
out vec3 vViewPosition;

bool inBoundsIJK(vec3 ijk) {
  return all(greaterThanEqual(ijk, vec3(0.0))) &&
         all(lessThan(ijk, uVolumeDims));
}

void main() {
  vec4 worldPos = modelMatrix * vec4(position, 1.0);
  vec3 ijk = (uWorldToIJK * worldPos).xyz;

  if (inBoundsIJK(ijk)) {
    vec3 uvw = (ijk + vec3(0.5)) / uVolumeDims;
    vValue = texture(uVolumeSampler, uvw).r;
    vInBounds = 1.0;
  } else {
    vValue = uFillValue;
    vInBounds = 0.0;
  }

  vNormalView = normalize(normalMatrix * normal);

  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  vViewPosition = -mvPosition.xyz;
  gl_Position = projectionMatrix * mvPosition;
}
`;

export const VOLUME_PROJECTION_FRAGMENT_SHADER = `
precision highp float;

uniform sampler2D uColormapSampler;
uniform vec2 uIntensityRange;
uniform vec2 uThreshold;
uniform float uOverlayOpacity;
uniform vec3 uBaseColor;
uniform float uFillValue;

uniform float uAmbientIntensity;
uniform float uDiffuseIntensity;
uniform float uSpecularIntensity;
uniform float uShininess;

in float vValue;
in float vInBounds;
in vec3 vNormalView;
in vec3 vViewPosition;

out vec4 outColor;

float normalizeValue(float v, float vmin, float vmax) {
  float range = max(vmax - vmin, 1e-10);
  return clamp((v - vmin) / range, 0.0, 1.0);
}

void main() {
  vec3 N = normalize(vNormalView);
  vec3 L = normalize(vec3(0.3, 0.5, 1.0));
  vec3 V = normalize(vViewPosition);
  vec3 H = normalize(L + V);

  float NdotL = max(dot(N, L), 0.0);
  float NdotH = max(dot(N, H), 0.0);

  float ambient = uAmbientIntensity;
  float diffuse = uDiffuseIntensity * NdotL;
  float specular = uSpecularIntensity * pow(NdotH, uShininess);
  float shade = ambient + diffuse + specular;

  vec3 baseRgb = uBaseColor * shade;

  // Match surfviewjs threshold semantics: hide values inside [min,max], show outside.
  bool thresholdActive = abs(uThreshold.x - uThreshold.y) > 1e-10;
  bool hiddenByThreshold = thresholdActive && (vValue >= uThreshold.x && vValue <= uThreshold.y);

  bool isFill = abs(vValue - uFillValue) < 1e-6;
  if (vInBounds < 0.5 || isFill || hiddenByThreshold) {
    outColor = vec4(baseRgb, 1.0);
    return;
  }

  float t = normalizeValue(vValue, uIntensityRange.x, uIntensityRange.y);
  vec3 overlayRgb = texture(uColormapSampler, vec2(t, 0.5)).rgb;
  overlayRgb *= shade;

  vec3 finalRgb = mix(baseRgb, overlayRgb, uOverlayOpacity);
  outColor = vec4(finalRgb, 1.0);
}
`;
