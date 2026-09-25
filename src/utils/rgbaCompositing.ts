import type { BlendMode } from '../layers';

/** A straight-alpha red, green, blue, alpha tuple with channels in [0, 1]. */
export type StraightRGBA = readonly [number, number, number, number];

/**
 * Composite alpha below which a surface fragment is discarded instead of drawn.
 *
 * Surface materials keep depth writes enabled so a closed mesh occludes itself;
 * discarding (effectively) fully transparent fragments is what lets an empty
 * layer stack stay see-through without writing depth. Half of one 8-bit step.
 */
export const SURFACE_ALPHA_DISCARD_THRESHOLD = 0.5 / 255;

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function assertRGBA(name: string, value: StraightRGBA): void {
  for (const [channel, sample] of value.entries()) {
    if (!Number.isFinite(sample) || sample < 0 || sample > 1) {
      throw new RangeError(
        `${name}[${channel}] must be finite and in [0, 1], got ${sample}`
      );
    }
  }
}

function compositeChannel(
  destination: number,
  destinationAlpha: number,
  source: number,
  sourceAlpha: number,
  outputAlpha: number,
  blendMode: BlendMode
): number {
  if (outputAlpha === 0) return 0;

  if (blendMode === 'additive') {
    const premultiplied = Math.min(
      1,
      destination * destinationAlpha + source * sourceAlpha
    );
    return clamp01(premultiplied / outputAlpha);
  }

  const blended = blendMode === 'multiply'
    ? destination * source
    : source;
  const premultiplied =
    (1 - sourceAlpha) * destinationAlpha * destination +
    (1 - destinationAlpha) * sourceAlpha * source +
    destinationAlpha * sourceAlpha * blended;
  return clamp01(premultiplied / outputAlpha);
}

function compositeAt(
  destination: Float32Array,
  destinationOffset: number,
  source: ArrayLike<number>,
  sourceOffset: number,
  blendMode: BlendMode,
  opacity: number
): void {
  // Callers establish equal RGBA-buffer lengths divisible by four before this hot loop.
  const destinationAlpha = clamp01(destination[destinationOffset + 3]!);
  const sourceAlpha = clamp01(source[sourceOffset + 3]!) * opacity;
  if (sourceAlpha === 0) return;

  const outputAlpha = blendMode === 'additive'
    ? Math.min(1, destinationAlpha + sourceAlpha)
    : sourceAlpha + destinationAlpha * (1 - sourceAlpha);

  for (let channel = 0; channel < 3; channel++) {
    destination[destinationOffset + channel] = compositeChannel(
      clamp01(destination[destinationOffset + channel]!),
      destinationAlpha,
      clamp01(source[sourceOffset + channel]!),
      sourceAlpha,
      outputAlpha,
      blendMode
    );
  }
  destination[destinationOffset + 3] = outputAlpha;
}

/**
 * Composite one straight-alpha source color over a straight-alpha destination.
 *
 * `normal` and `multiply` use the W3C separable-blend/source-over equation.
 * `additive` uses Porter-Duff plus-lighter: premultiplied source and destination
 * channels and alpha are added and clamped. Layer opacity scales source alpha
 * exactly once; it never scales straight RGB channels.
 *
 * The returned tuple is straight alpha. Three.js `NormalBlending` subsequently
 * writes its premultiplied equivalent to a transparent framebuffer or blends it
 * source-over an opaque canvas clear color.
 */
export function compositeStraightRGBA(
  destination: StraightRGBA,
  source: StraightRGBA,
  blendMode: BlendMode = 'normal',
  opacity = 1
): StraightRGBA {
  assertRGBA('destination', destination);
  assertRGBA('source', source);
  if (!Number.isFinite(opacity) || opacity < 0 || opacity > 1) {
    throw new RangeError(`opacity must be finite and in [0, 1], got ${opacity}`);
  }

  const result = new Float32Array(destination);
  compositeAt(result, 0, source, 0, blendMode, opacity);
  // `result` is constructed from a four-channel tuple above.
  return [result[0]!, result[1]!, result[2]!, result[3]!];
}

/**
 * Composite a full straight-alpha RGBA buffer into `destination` in place.
 * This is the allocation-free CPU production path used by brain surfaces.
 */
export function compositeStraightRGBABuffer(
  destination: Float32Array,
  source: ArrayLike<number>,
  blendMode: BlendMode,
  opacity: number
): void {
  if (destination.length !== source.length || destination.length % 4 !== 0) {
    throw new RangeError(
      `RGBA buffers must have the same length divisible by 4, got ` +
      `${destination.length} and ${source.length}`
    );
  }
  if (!Number.isFinite(opacity) || opacity < 0 || opacity > 1) {
    throw new RangeError(`opacity must be finite and in [0, 1], got ${opacity}`);
  }

  for (let offset = 0; offset < destination.length; offset += 4) {
    compositeAt(destination, offset, source, offset, blendMode, opacity);
  }
}

/** Convert straight-alpha RGBA to the premultiplied representation in a framebuffer. */
export function premultiplyStraightRGBA(color: StraightRGBA): StraightRGBA {
  assertRGBA('color', color);
  return [
    color[0] * color[3],
    color[1] * color[3],
    color[2] * color[3],
    color[3]
  ];
}
