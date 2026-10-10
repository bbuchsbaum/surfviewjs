import { describe, expect, it } from 'vitest';
import { resolveParcelPuzzleBackgrounds } from '../../src/puzzle/ParcelPuzzleView';
import { puzzleStyles } from '../../src/puzzle/puzzleStyles';

/** Strip every `var(--name, fallback)` so only literals outside custom properties remain. */
function withoutCustomProperties(css: string): string {
  let previous = '';
  let current = css;
  while (current !== previous) {
    previous = current;
    current = current.replace(/var\(--[\w-]+(?:,[^()]*(?:\([^()]*\)[^()]*)*)?\)/g, 'VAR');
  }
  return current;
}

describe('parcel puzzle theming', () => {
  it('keeps the current light stage and preview colours by default', () => {
    expect(resolveParcelPuzzleBackgrounds({})).toEqual({
      background: 0xf0f3f4,
      previewBackground: 0xedf1f2
    });
  });

  it('accepts explicit stage and preview clear colours independently', () => {
    expect(resolveParcelPuzzleBackgrounds({ background: 0x0f1720 })).toEqual({
      background: 0x0f1720,
      previewBackground: 0xedf1f2
    });
    expect(resolveParcelPuzzleBackgrounds({ background: 0x0f1720, previewBackground: 0x101820 }))
      .toEqual({ background: 0x0f1720, previewBackground: 0x101820 });
  });

  it('rejects colours that are not 24-bit RGB integers', () => {
    expect(() => resolveParcelPuzzleBackgrounds({ background: -1 })).toThrow(RangeError);
    expect(() => resolveParcelPuzzleBackgrounds({ previewBackground: 0x1000000 })).toThrow(RangeError);
    expect(() => resolveParcelPuzzleBackgrounds({ background: 1.5 })).toThrow(RangeError);
  });

  it('drives every colour and radius from custom properties whose fallbacks are the current values', () => {
    const literals = withoutCustomProperties(puzzleStyles);
    expect(literals).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(literals).not.toMatch(/border-radius:\s*\d/);

    for (const [property, fallback] of [
      ['--sv-parcel-puzzle-background', '#f0f3f4'],
      ['--sv-parcel-puzzle-detail-background', '#fafbfb'],
      ['--sv-parcel-puzzle-preview-background', '#edf1f2'],
      ['--sv-parcel-puzzle-radius', '12px'],
      ['--sv-parcel-puzzle-preview-radius', '8px'],
      ['--sv-parcel-puzzle-color', '#253843'],
      ['--sv-parcel-puzzle-border-color', '#dce3e6'],
      ['--sv-parcel-puzzle-focus-color', '#23748a']
    ] as const) {
      expect(puzzleStyles).toContain(`var(${property},${fallback})`);
    }
  });
});
