export const VOLUME_PROJECTION_VERTEX_SHADER = `
precision highp float;
precision highp sampler3D;

uniform sampler3D uVolumeSampler;
uniform mat4 uWorldToIJK;
uniform vec3 uVolumeDims;
uniform float uFillValue;
uniform int uProjectionMode;

in vec3 pialPosition;
in vec3 whitePosition;

out float vValue;
out float vInBounds;
out vec3 vWorldPosition;
out vec3 vPialWorldPosition;
out vec3 vWhiteWorldPosition;
out vec3 vNormalView;
out vec3 vViewPosition;

bool inBoundsIJK(vec3 ijk) {
  return all(greaterThanEqual(ijk, vec3(0.0))) &&
         all(lessThan(ijk, uVolumeDims));
}

void main() {
  vec4 worldPos = modelMatrix * vec4(position, 1.0);
  vWorldPosition = worldPos.xyz;
  vPialWorldPosition = (modelMatrix * vec4(pialPosition, 1.0)).xyz;
  vWhiteWorldPosition = (modelMatrix * vec4(whitePosition, 1.0)).xyz;
  vec3 ijk = (uWorldToIJK * worldPos).xyz;

  if (uProjectionMode == 0 && inBoundsIJK(ijk)) {
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
  gl_PointSize = 1.0;
}
`;

export const VOLUME_PROJECTION_FRAGMENT_SHADER = `
precision highp float;
precision highp sampler3D;

uniform sampler3D uVolumeSampler;
uniform mat4 uWorldToIJK;
uniform vec3 uVolumeDims;

uniform sampler2D uColormapSampler;
uniform vec2 uIntensityRange;
uniform vec2 uThreshold;
uniform float uOverlayOpacity;
uniform vec3 uBaseColor;
uniform float uFillValue;
uniform int uProjectionMode;
uniform int uRibbonSamples;
uniform int uRibbonReducer;

uniform float uAmbientIntensity;
uniform float uDiffuseIntensity;
uniform float uSpecularIntensity;
uniform float uShininess;

in float vValue;
in float vInBounds;
in vec3 vWorldPosition;
in vec3 vPialWorldPosition;
in vec3 vWhiteWorldPosition;
in vec3 vNormalView;
in vec3 vViewPosition;

out vec4 outColor;

float normalizeValue(float v, float vmin, float vmax) {
  float range = max(vmax - vmin, 1e-10);
  return clamp((v - vmin) / range, 0.0, 1.0);
}

bool inBoundsUVW(vec3 uvw) {
  return all(greaterThanEqual(uvw, vec3(0.0))) && all(lessThanEqual(uvw, vec3(1.0)));
}

float sampleAtWorld(vec3 worldPos, out bool ok) {
  vec3 ijk = (uWorldToIJK * vec4(worldPos, 1.0)).xyz;
  vec3 uvw = (ijk + vec3(0.5)) / uVolumeDims;
  if (!inBoundsUVW(uvw)) {
    ok = false;
    return uFillValue;
  }
  ok = true;
  return texture(uVolumeSampler, uvw).r;
}

float reduceRibbon(out bool ok) {
  float sumValue = 0.0;
  float maxValue = -3.402823466e38;
  float minValue = 3.402823466e38;
  float values[16];
  int count = 0;
  int samples = clamp(uRibbonSamples, 1, 16);

  for (int s = 0; s < 16; s++) {
    if (s >= samples) break;
    float denom = max(float(samples - 1), 1.0);
    float t = samples == 1 ? 0.5 : float(s) / denom;
    bool sampleOk = false;
    float v = sampleAtWorld(mix(vWhiteWorldPosition, vPialWorldPosition, t), sampleOk);
    if (sampleOk && abs(v - uFillValue) >= 1e-6) {
      values[count] = v;
      count++;
      sumValue += v;
      maxValue = max(maxValue, v);
      minValue = min(minValue, v);
    }
  }

  if (count == 0) {
    ok = false;
    return uFillValue;
  }

  ok = true;
  if (uRibbonReducer == 1) return maxValue;
  if (uRibbonReducer == 2) return minValue;
  if (uRibbonReducer == 3) {
    for (int i = 0; i < 16; i++) {
      if (i >= count) break;
      for (int j = i + 1; j < 16; j++) {
        if (j >= count) break;
        if (values[j] < values[i]) {
          float tmp = values[i];
          values[i] = values[j];
          values[j] = tmp;
        }
      }
    }
    int mid = count / 2;
    if ((count / 2) * 2 == count && count > 1) {
      return 0.5 * (values[mid - 1] + values[mid]);
    }
    return values[mid];
  }
  return sumValue / float(count);
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

  float projectedValue = vValue;
  float projectedInBounds = vInBounds;
  if (uProjectionMode == 1) {
    bool ok = false;
    projectedValue = sampleAtWorld(vWorldPosition, ok);
    projectedInBounds = ok ? 1.0 : 0.0;
  } else if (uProjectionMode == 2) {
    bool ok = false;
    projectedValue = reduceRibbon(ok);
    projectedInBounds = ok ? 1.0 : 0.0;
  }

  // Match surfviewjs threshold semantics: hide values inside [min,max], show outside.
  bool thresholdActive = abs(uThreshold.x - uThreshold.y) > 1e-10;
  bool hiddenByThreshold = thresholdActive && (projectedValue >= uThreshold.x && projectedValue <= uThreshold.y);

  bool isFill = abs(projectedValue - uFillValue) < 1e-6;
  if (projectedInBounds < 0.5 || isFill || hiddenByThreshold) {
    outColor = vec4(baseRgb, 1.0);
    return;
  }

  float t = normalizeValue(projectedValue, uIntensityRange.x, uIntensityRange.y);
  vec3 overlayRgb = texture(uColormapSampler, vec2(t, 0.5)).rgb;
  overlayRgb *= shade;

  vec3 finalRgb = mix(baseRgb, overlayRgb, uOverlayOpacity);
  outColor = vec4(finalRgb, 1.0);
}
`;
