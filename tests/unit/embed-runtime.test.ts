import { describe, expect, it } from 'vitest';
import { SURFVIEW_EMBED_THREE_REVISION } from '../../src/embed';

describe('SurfView embed runtime', () => {
  it('pins one modern Three.js revision', () => {
    expect(SURFVIEW_EMBED_THREE_REVISION).toBe('185');
  });
});
