import { SURFVIEW_VERSION } from '@src/index.js';
import { FilmOverlay } from './film';
import type { Scenario, ScenarioCleanup } from '../types';

/**
 * Run one chapter on its own page (demo/puzzle.html, demo/map-lab.html): the same film,
 * corners and margin as the gallery, without the chapter strip.
 */
export function runStandalone(scenario: Scenario): void {
  const app = document.getElementById('app')!;
  const frame = document.getElementById('viewer-frame')!;
  const mount = document.getElementById('viewer-mount')!;
  const panel = document.getElementById('panel')!;
  const statusEl = document.getElementById('status-text')!;
  const perfEl = document.getElementById('perf-text')!;
  app.dataset.scenario = scenario.id;
  document.getElementById('edge-mark')!.textContent = `SURFVIEW ${SURFVIEW_VERSION}`;
  document.getElementById('active-title')!.textContent = scenario.title;
  document.getElementById('active-desc')!.textContent = scenario.summary;
  const synthetic = document.getElementById('active-synthetic')!;
  synthetic.hidden = !scenario.synthetic;
  synthetic.textContent = scenario.synthetic ?? '';

  const film = new FilmOverlay(frame);
  const setBusy = (busy: boolean, label?: string) => {
    frame.classList.toggle('busy', busy);
    frame.setAttribute('aria-busy', String(busy));
    if (label) statusEl.textContent = label;
  };
  let cleanup: ScenarioCleanup;
  let closed = false;
  void Promise.resolve(scenario.run({
    mount, panel, film,
    params: new URLSearchParams(location.search),
    status: message => { statusEl.textContent = message; },
    perf: message => { perfEl.textContent = message; },
    setBusy
  })).then(result => {
    cleanup = result;
    if (closed) void cleanup?.();
    else if (!statusEl.textContent?.startsWith('Ready')) statusEl.textContent = `Running: ${scenario.title}`;
  }).catch(error => {
    console.error(error);
    statusEl.textContent = 'Chapter failed to start';
    const message = document.createElement('p');
    message.className = 'scenario-error';
    message.textContent = `This chapter could not start: ${error instanceof Error ? error.message : String(error)}.`;
    mount.replaceChildren(message);
  }).finally(() => setBusy(false));
  window.addEventListener('pagehide', () => {
    closed = true;
    void cleanup?.();
  }, { once: true });
}
