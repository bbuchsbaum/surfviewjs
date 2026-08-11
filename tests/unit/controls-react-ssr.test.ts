import React from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

describe('React controls adapter SSR boundary', () => {
  it('imports and renders an inert host without DOM access or layout-effect warnings', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const { SurfViewControls } = await import('../../src/controls-ui/react');
      const markup = renderToString(React.createElement(SurfViewControls, {
        viewer: null,
        className: 'server-controls',
        'aria-label': 'Server controls host'
      }));

      expect(markup).toContain('class="server-controls"');
      expect(markup).toContain('aria-label="Server controls host"');
      expect(consoleError).not.toHaveBeenCalled();
    } finally {
      consoleError.mockRestore();
    }
  });
});
