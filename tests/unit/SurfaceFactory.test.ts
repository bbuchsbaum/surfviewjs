import { describe, it, expect } from 'vitest';
import { SurfaceFactory } from '../../src/SurfaceFactory';
import { MultiLayerNeuroSurface } from '../../src/MultiLayerNeuroSurface';
import { ColorMappedNeuroSurface, VertexColoredNeuroSurface } from '../../src/classes';

// Polyfill requestAnimationFrame for Node
if (typeof globalThis.requestAnimationFrame === 'undefined') {
  (globalThis as any).requestAnimationFrame = (cb: () => void) => setTimeout(cb, 0);
  (globalThis as any).cancelAnimationFrame = (id: number) => clearTimeout(id);
}

const vertices = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
const faces = new Uint32Array([0, 1, 2]);

describe('SurfaceFactory', () => {
  it('creates a multi-layer surface', () => {
    const surface = SurfaceFactory.fromConfig({
      type: 'multi-layer',
      vertices,
      faces,
      hemisphere: 'left'
    });
    expect(surface).toBeInstanceOf(MultiLayerNeuroSurface);
  });

  it('creates a color-mapped surface', () => {
    const surface = SurfaceFactory.fromConfig({
      type: 'color-mapped',
      vertices,
      faces,
      data: new Float32Array([0, 0.5, 1]),
      colorMap: 'jet'
    });
    expect(surface).toBeInstanceOf(ColorMappedNeuroSurface);
  });

  it('creates a vertex-colored surface', () => {
    const surface = SurfaceFactory.fromConfig({
      type: 'vertex-colored',
      vertices,
      faces,
      colors: [0xff0000, 0x00ff00, 0x0000ff]
    });
    expect(surface).toBeInstanceOf(VertexColoredNeuroSurface);
  });

  it('throws for vertex-colored without colors', () => {
    expect(() => SurfaceFactory.fromConfig({
      type: 'vertex-colored',
      vertices,
      faces
    })).toThrow('vertex-colored surface requires colors array');
  });

  it('throws for unknown surface type', () => {
    expect(() => SurfaceFactory.fromConfig({
      type: 'unknown-type' as any,
      vertices,
      faces
    })).toThrow('Unsupported surface type');
  });

  it('defaults hemisphere to unknown when not provided', () => {
    const surface = SurfaceFactory.fromConfig({
      type: 'multi-layer',
      vertices,
      faces
    });
    expect(surface.hemisphere).toBe('unknown');
  });

  it('create() is an alias for fromConfig()', () => {
    const surface = SurfaceFactory.create({
      type: 'multi-layer',
      vertices,
      faces
    });
    expect(surface).toBeInstanceOf(MultiLayerNeuroSurface);
  });
});
