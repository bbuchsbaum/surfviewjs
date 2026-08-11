/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createSurfViewControlSession
} from '../../src';
import {
  defineSurfViewControlsElement,
  SURFVIEW_CONTROLS_TAG,
  SurfViewControlsElement
} from '../../src/controls-ui';
import { ReportControls } from '../../src/report/ReportControls';
import { makeReportFixture } from './report-scene-fixture';

async function nextSessionDelivery(): Promise<void> {
  await new Promise<void>(resolve => queueMicrotask(resolve));
}

beforeEach(() => {
  vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

describe('compact report controls', () => {
  it('uses native grouped controls and derives labels and legend from target descriptors', () => {
    const fixture = makeReportFixture();
    const viewTarget = fixture.controller.getViewTarget();
    if (!viewTarget) throw new Error('fixture report target is missing');
    fixture.controller.setAnatomicalView('lateral', viewTarget);
    const controls = new ReportControls(fixture.target);
    document.body.appendChild(controls.element);

    try {
      expect(controls.element.tagName).toBe('SECTION');
      expect(controls.element.getAttribute('aria-label')).toBe('Surface report controls');
      expect(controls.element.hasAttribute('role')).toBe(false);
      expect(controls.element.querySelector('fieldset legend')?.textContent)
        .toBe('Anatomical view');

      const select = controls.element.querySelector('select');
      expect(select?.value).toBe('response');
      expect([...select!.options].map(option => [option.value, option.textContent]))
        .toEqual([
          ['response', 'Language response'],
          ['uncertainty', 'Standard error']
        ]);
      expect(controls.element.textContent).toContain('Language response: -3 to 5 z');

      const radios = [...controls.element.querySelectorAll<HTMLInputElement>(
        'input[type="radio"]'
      )];
      expect(radios).toHaveLength(6);
      expect(new Set(radios.map(input => input.name)).size).toBe(1);
      expect(radios.every(input => !input.hasAttribute('tabindex'))).toBe(true);
      expect(radios.find(input => input.value === 'lateral')?.checked).toBe(true);
    } finally {
      controls.dispose();
      fixture.dispose();
    }
  });

  it('shares canonical report state with an explicitly mounted full panel but keeps sessions local', async () => {
    const fixture = makeReportFixture();
    const controls = new ReportControls(fixture.target, {
      session: { focusedSurfaceId: 'lh', advancedVisible: false }
    });
    const panelSession = createSurfViewControlSession(fixture.target, {
      focusedSurfaceId: 'rh', advancedVisible: true
    });
    defineSurfViewControlsElement();
    const panel = document.createElement(SURFVIEW_CONTROLS_TAG) as SurfViewControlsElement;
    panel.session = panelSession;
    document.body.append(controls.element, panel);
    await panel.updateComplete;

    try {
      expect(controls.session).not.toBe(panelSession);
      expect(controls.session.getSnapshot().state).toMatchObject({
        focusedSurfaceId: 'lh',
        advancedVisible: false
      });
      expect(panelSession.getSnapshot().state).toMatchObject({
        focusedSurfaceId: 'rh',
        advancedVisible: true
      });
      expect(controls.session.getSnapshot().canonical)
        .toBe(panelSession.getSnapshot().canonical);

      const select = controls.element.querySelector('select')!;
      select.value = 'uncertainty';
      select.dispatchEvent(new Event('change', { bubbles: true }));
      await nextSessionDelivery();
      await panel.updateComplete;

      expect(panelSession.getSnapshot().canonical.capabilities.exclusiveMap)
        .toMatchObject({ displayedLayerId: 'uncertainty' });
      expect(panel.snapshot?.canonical.capabilities.exclusiveMap)
        .toMatchObject({ displayedLayerId: 'uncertainty' });
      expect(controls.session.getSnapshot().state.focusedSurfaceId).toBe('lh');
      expect(panelSession.getSnapshot().state.focusedSurfaceId).toBe('rh');

      const target = panelSession.getSnapshot().canonical.view.targets[0]?.target;
      if (!target) throw new Error('fixture report view target is missing');
      expect(panelSession.setAnatomicalView({ view: 'ventral', target }))
        .toEqual({ ok: true });
      await nextSessionDelivery();

      expect(controls.element.querySelector<HTMLInputElement>(
        'input[value="ventral"]'
      )?.checked).toBe(true);
      expect(controls.session.getSnapshot().state.advancedVisible).toBe(false);
      expect(panelSession.getSnapshot().state.advancedVisible).toBe(true);
    } finally {
      panel.dispose();
      panelSession.dispose();
      controls.dispose();
      fixture.dispose();
    }
  });

  it('routes map, all paired report views, reset, and export through its session', async () => {
    const fixture = makeReportFixture();
    fixture.viewer.selectedLayerId = 'legacy-layer';
    const exported = vi.fn();
    const controls = new ReportControls(fixture.target, {
      filename: 'report-fixture.png',
      onExport: exported
    });
    document.body.appendChild(controls.element);

    try {
      const select = controls.element.querySelector('select')!;
      select.value = 'uncertainty';
      select.dispatchEvent(new Event('change', { bubbles: true }));
      await nextSessionDelivery();
      expect(fixture.target.getSnapshot().capabilities.exclusiveMap?.displayedLayerId)
        .toBe('uncertainty');
      expect(fixture.viewer.selectedLayerId).toBe('legacy-layer');

      for (const view of ['lateral', 'medial', 'dorsal', 'ventral'] as const) {
        const radio = controls.element.querySelector<HTMLInputElement>(
          `input[value="${view}"]`
        )!;
        radio.checked = true;
        radio.dispatchEvent(new Event('change', { bubbles: true }));
        await nextSessionDelivery();
        expect(fixture.target.getSnapshot().view.current?.view).toBe(view);
        expect(radio.checked).toBe(true);
      }

      controls.element.querySelector<HTMLButtonElement>('button')!.click();
      await nextSessionDelivery();
      expect(fixture.target.getSnapshot().view.current?.view).toBe('lateral');

      controls.element.querySelector<HTMLButtonElement>(
        'button[aria-label="Export surface view as PNG"]'
      )!.click();
      await vi.waitFor(() => expect(exported).toHaveBeenCalledTimes(1));
      expect(exported).toHaveBeenCalledWith(expect.objectContaining({
        dataUrl: 'data:image/png;base64,cmVwb3J0',
        mimeType: 'image/png',
        filename: null
      }));
      expect(fixture.viewer.exportPNG).toHaveBeenCalledWith(
        expect.not.objectContaining({ downloadFilename: expect.anything() })
      );
    } finally {
      controls.dispose();
      fixture.dispose();
    }
  });

  it('owns and disposes one session exactly once without taking target ownership', () => {
    const fixture = makeReportFixture();
    const controls = new ReportControls(fixture.target);
    const disposeSession = vi.spyOn(controls.session, 'dispose');
    document.body.appendChild(controls.element);

    controls.dispose();
    controls.dispose();

    expect(disposeSession).toHaveBeenCalledTimes(1);
    expect(controls.isDisposed()).toBe(true);
    expect(controls.session.isDisposed()).toBe(true);
    expect(controls.element.isConnected).toBe(false);
    expect(fixture.target.isDisposed()).toBe(false);
    expect(fixture.target.setDisplayedLayer('uncertainty')).toEqual({ ok: true });
    fixture.dispose();
  });

  it('restores canonical native state when a typed command fails', () => {
    const fixture = makeReportFixture();
    const controls = new ReportControls(fixture.target);
    document.body.appendChild(controls.element);
    const select = controls.element.querySelector('select')!;
    const uncertainty = select.querySelector<HTMLOptionElement>(
      'option[value="uncertainty"]'
    )!;

    fixture.target.dispose();
    uncertainty.selected = true;
    select.dispatchEvent(new Event('change', { bubbles: true }));

    expect(select.value).toBe('response');
    expect(controls.element.textContent).toContain(
      'The report-scene control target has been disposed.'
    );
    controls.dispose();
    fixture.dispose();
  });

  it('contains rejected and throwing export integrations and ignores completion after disposal', async () => {
    const fixture = makeReportFixture();
    const exportFigure = vi.spyOn(fixture.target, 'exportFigure');
    const onExport = vi.fn(() => {
      throw new Error('download integration failed');
    });
    const controls = new ReportControls(fixture.target, { onExport });
    document.body.appendChild(controls.element);
    const button = controls.element.querySelector<HTMLButtonElement>(
      'button[aria-label="Export surface view as PNG"]'
    )!;

    exportFigure.mockRejectedValueOnce(new Error('target export rejected'));
    button.click();
    await vi.waitFor(() => {
      expect(controls.element.textContent).toContain('target export rejected');
    });

    exportFigure.mockResolvedValueOnce({
      ok: true,
      value: {
        dataUrl: 'data:image/png;base64,ZmFrZQ==',
        mimeType: 'image/png',
        width: 10,
        height: 10,
        filename: null
      }
    });
    button.click();
    await vi.waitFor(() => expect(onExport).toHaveBeenCalledTimes(1));
    expect(controls.element.textContent).toContain('download integration failed');

    let resolveDeferred!: (result: Awaited<ReturnType<typeof fixture.target.exportFigure>>) => void;
    exportFigure.mockReturnValueOnce(new Promise(resolve => {
      resolveDeferred = resolve;
    }));
    button.click();
    controls.dispose();
    resolveDeferred({
      ok: true,
      value: {
        dataUrl: 'data:image/png;base64,bGF0ZQ==',
        mimeType: 'image/png',
        width: 10,
        height: 10,
        filename: null
      }
    });
    await nextSessionDelivery();
    expect(onExport).toHaveBeenCalledTimes(1);
    fixture.dispose();
  });
});
