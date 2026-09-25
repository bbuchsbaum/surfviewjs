import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  compositeStraightRGBA,
  compositeStraightRGBABuffer,
  premultiplyStraightRGBA,
  SURFACE_ALPHA_DISCARD_THRESHOLD
} from '../../src/utils/rgbaCompositing';
import { MultiLayerNeuroSurface } from '../../src/MultiLayerNeuroSurface';
import { SurfaceGeometry } from '../../src/classes';
import { RGBALayer } from '../../src/layers';
import type { BlendMode } from '../../src/layers';

const destination = [0.2, 0.4, 0.6, 0.5] as const;
const source = [0.8, 0.2, 0.4, 0.5] as const;

function expectRGBA(
  actual: ArrayLike<number>,
  expected: readonly number[],
  precision = 6
): void {
  expect(Array.from(actual)).toHaveLength(4);
  expected.forEach((value, channel) => {
    expect(actual[channel]).toBeCloseTo(value, precision);
  });
}

function constantRGBA(color: readonly [number, number, number, number]): Float32Array {
  return new Float32Array([...color, ...color, ...color]);
}

function makeSurface(baseColor = 0x000000): MultiLayerNeuroSurface {
  const geometry = new SurfaceGeometry(
    new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
    new Uint32Array([0, 1, 2]),
    'lh'
  );
  return new MultiLayerNeuroSurface(geometry, { baseColor });
}

function compositeBuffer(surface: MultiLayerNeuroSurface): Float32Array {
  return (surface as unknown as { compositeBuffer: Float32Array }).compositeBuffer;
}

beforeEach(() => {
  vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('straight RGBA reference algebra', () => {
  it.each([
    ['normal', [0.44, 0.32, 0.52, 0.625]],
    ['multiply', [0.312, 0.296, 0.488, 0.625]],
    ['additive', [0.4, 1 / 3, 8 / 15, 0.75]]
  ] as const)('matches the hand-derived translucent %s result', (mode, expected) => {
    expectRGBA(compositeStraightRGBA(destination, source, mode, 0.5), expected);
  });

  it.each(['normal', 'multiply', 'additive'] as const)(
    'preserves the destination at opacity zero for %s',
    mode => {
      expectRGBA(compositeStraightRGBA(destination, source, mode, 0), destination);
    }
  );

  it('handles transparent destinations and intrinsic transparent sources', () => {
    expectRGBA(
      compositeStraightRGBA([0, 0, 0, 0], source, 'multiply', 0.5),
      [0.8, 0.2, 0.4, 0.25]
    );
    expectRGBA(
      compositeStraightRGBA(destination, [1, 0, 0, 0], 'additive', 1),
      destination
    );
  });

  it('covers opaque normal, multiply, and plus-lighter boundaries', () => {
    expectRGBA(
      compositeStraightRGBA([0.2, 0.4, 0.6, 1], [0.8, 0.2, 0.4, 1], 'normal'),
      [0.8, 0.2, 0.4, 1]
    );
    expectRGBA(
      compositeStraightRGBA([0.2, 0.4, 0.6, 1], [0.8, 0.2, 0.4, 1], 'multiply'),
      [0.16, 0.08, 0.24, 1]
    );
    expectRGBA(
      compositeStraightRGBA([0.4, 0.9, 0.2, 1], [0.8, 0.3, 0.9, 1], 'additive'),
      [1, 1, 1, 1]
    );
  });

  it('documents transparent-framebuffer and opaque-canvas output', () => {
    const foreground = [0.2, 0.4, 0.6, 0.25] as const;
    expectRGBA(premultiplyStraightRGBA(foreground), [0.05, 0.1, 0.15, 0.25]);
    expectRGBA(
      compositeStraightRGBA([1, 1, 1, 1], foreground, 'normal'),
      [0.8, 0.85, 0.9, 1]
    );
  });

  it('is order-sensitive and composites full buffers in place', () => {
    const red = [1, 0, 0, 0.5] as const;
    const blue = [0, 0, 1, 0.5] as const;
    const redThenBlue = compositeStraightRGBA(
      compositeStraightRGBA([0, 0, 0, 0], red),
      blue
    );
    const blueThenRed = compositeStraightRGBA(
      compositeStraightRGBA([0, 0, 0, 0], blue),
      red
    );
    expect(redThenBlue).not.toEqual(blueThenRed);

    const buffer = new Float32Array([0, 0, 0, 0, ...destination]);
    const overlay = new Float32Array([...red, ...source]);
    compositeStraightRGBABuffer(buffer, overlay, 'normal', 0.5);
    expectRGBA(buffer.subarray(0, 4), [1, 0, 0, 0.25]);
    expectRGBA(buffer.subarray(4, 8), [0.44, 0.32, 0.52, 0.625]);
  });

  it('rejects invalid channels, opacity, and buffer shapes', () => {
    expect(() => compositeStraightRGBA(destination, [1, 0, 0, NaN])).toThrow(RangeError);
    expect(() => compositeStraightRGBA(destination, source, 'normal', -0.1)).toThrow(RangeError);
    expect(() => compositeStraightRGBABuffer(
      new Float32Array(4),
      new Float32Array(8),
      'normal',
      1
    )).toThrow(RangeError);
  });
});

describe('CPU production compositing', () => {
  it('renders black as black and an empty stack as transparent', () => {
    const surface = makeSurface(0x000000);
    try {
      expectRGBA(compositeBuffer(surface).subarray(0, 4), [0, 0, 0, 1]);
      surface.clearLayers({ includeBase: true });
      surface.updateColors();
      expectRGBA(compositeBuffer(surface).subarray(0, 4), [0, 0, 0, 0]);

      const material = surface.mesh!.material as THREE.MeshPhongMaterial;
      expect(material.transparent).toBe(true);
      expect(material.depthTest).toBe(true);
      expect(material.depthWrite).toBe(false);
      // Alpha-0 fragments are discarded so they never draw or write depth.
      expect(material.alphaTest).toBe(SURFACE_ALPHA_DISCARD_THRESHOLD);
      expect(material.alphaTest).toBeGreaterThan(0);
      expect(material.blending).toBe(THREE.NormalBlending);
      expect(material.premultipliedAlpha).toBe(false);
      expect(surface.mesh!.geometry.getAttribute('color').itemSize).toBe(4);
    } finally {
      surface.dispose();
    }
  });

  it.each(['normal', 'multiply', 'additive'] as const)(
    'matches the pure oracle for stacked %s overlays and applies opacity once',
    (mode: BlendMode) => {
      const surface = makeSurface();
      try {
        surface.clearLayers({ includeBase: true });
        const first = new RGBALayer('first', constantRGBA(destination), {
          blendMode: 'normal'
        });
        const second = new RGBALayer('second', constantRGBA(source), {
          blendMode: mode,
          opacity: 0.5
        });
        surface.addLayer(first);
        surface.addLayer(second);
        surface.updateColors();

        const expected = compositeStraightRGBA(destination, source, mode, 0.5);
        expectRGBA(compositeBuffer(surface).subarray(0, 4), expected, 5);

        second.setVisible(false);
        surface.updateColors();
        expectRGBA(compositeBuffer(surface).subarray(0, 4), destination);
      } finally {
        surface.dispose();
      }
    }
  );

  it('defers a requested GPU path until attachment and degrades explicitly without WebGL2', () => {
    const geometry = new SurfaceGeometry(
      new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
      new Uint32Array([0, 1, 2]),
      'lh'
    );
    const surface = new MultiLayerNeuroSurface(geometry, {
      useGPUCompositing: true
    });
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      expect(surface.getCompositingMode()).toBe('CPU');
      surface.viewer = {
        renderer: { capabilities: { isWebGL2: false } }
      };
      surface.activateConfiguredCompositor();
      expect(surface.getCompositingMode()).toBe('CPU');
      expect(warning).toHaveBeenCalledWith(
        'GPU compositing unavailable: WebGL2 is required for sampler2DArray and sampler3D; keeping CPU mode'
      );
    } finally {
      warning.mockRestore();
      surface.dispose();
    }
  });
});
