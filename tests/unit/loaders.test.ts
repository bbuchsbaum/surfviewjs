import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { parseGIfTISurface } from '../../src/loaders';

const DOMParserImpl = new JSDOM().window.DOMParser;

function readFixture(name: string): string {
  return readFileSync(new URL(`../data/${name}`, import.meta.url), 'utf8');
}

describe('parseGIfTISurface', () => {
  it('parses GZipBase64Binary GIFTI surface fixtures', () => {
    const result = parseGIfTISurface(
      readFixture('tetrahedron_gzip.gii'),
      DOMParserImpl
    );

    expect(result.vertices.length / 3).toBe(4);
    expect(result.faces.length / 3).toBe(4);
  });

  it('falls back for deflate payloads marked as GZipBase64Binary', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    try {
      const result = parseGIfTISurface(
        readFixture('fsaverage5-lh-pial.gii'),
        DOMParserImpl
      );

      expect(result.vertices.length / 3).toBeGreaterThan(1000);
      expect(result.faces.length / 3).toBeGreaterThan(1000);
    } finally {
      warn.mockRestore();
    }
  });
});
