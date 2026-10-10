import '@fontsource-variable/archivo/wdth.css';
import '@fontsource-variable/jetbrains-mono/wght.css';
import './style.css';
import { SURFVIEW_VERSION } from '@src/index.js';
import { STRIP_SUBJECTS, scenarios } from './manifest';
import { FilmOverlay } from './kit/film';
import type { Scenario, ScenarioCleanup, ScenarioGroup, ScenarioRunContext } from './types';

const app = document.getElementById('app')!;
const workspace = document.querySelector<HTMLElement>('.workspace')!;
const listEl = document.getElementById('scenario-list')!;
const statusEl = document.getElementById('status-text')!;
const perfEl = document.getElementById('perf-text')!;
const titleEl = document.getElementById('active-title')!;
const descEl = document.getElementById('active-desc')!;
const syntheticEl = document.getElementById('active-synthetic')!;
const resetBtn = document.getElementById('reset-btn') as HTMLButtonElement;
const viewerSlot = document.getElementById('viewer-slot')!;
const panel = document.getElementById('panel')!;
const viewerFrame = document.getElementById('viewer-frame')!;
const codeBlock = document.getElementById('code-block') as HTMLDetailsElement;
const codeText = document.getElementById('code-text')!;
const codeCopy = document.getElementById('code-copy') as HTMLButtonElement;

document.getElementById('edge-mark')!.textContent = `SURFVIEW ${SURFVIEW_VERSION}`;
document.getElementById('npm-link')!.textContent = `npm ${SURFVIEW_VERSION}`;

const film = new FilmOverlay(viewerFrame);
const scenarioMap = new Map(scenarios.map(scenario => [scenario.id, scenario]));
const aliasMap = new Map(scenarios.flatMap(scenario => (scenario.aliases ?? []).map(alias => [alias, scenario.id] as const)));
/** Query parameters a chapter understands; everything else is dropped on navigation. */
const CHAPTER_PARAMS = ['atlas', 'dataset', 'mode', 'task'];

const BANKS: ReadonlyArray<{ group: ScenarioGroup; label: string }> = [
  { group: 'surfaces', label: 'Surfaces' },
  { group: 'atlases', label: 'Atlases' },
  { group: 'workflows', label: 'Workflows' }
];

let activeCleanup: (() => Promise<void>) | null = null;
let activeId: string | null = null;
let navigationRevision = 0;

function resolveId(id: string | null): string | null {
  if (!id) return null;
  if (scenarioMap.has(id)) return id;
  return aliasMap.get(id) ?? null;
}

function setBusy(busy: boolean, label?: string) {
  viewerFrame.classList.toggle('busy', busy);
  viewerFrame.setAttribute('aria-busy', String(busy));
  if (label) statusEl.textContent = label;
}

function renderStrip() {
  const banks = BANKS.map(bank => {
    const members = scenarios.filter(scenario => scenario.group === bank.group);
    if (members.length === 0) return null;
    const element = document.createElement('div');
    element.className = 'bank';
    element.style.setProperty('--bank-size', String(members.length));
    element.setAttribute('role', 'group');
    element.setAttribute('aria-label', bank.label);
    const label = document.createElement('span');
    label.className = 'bank-label';
    label.textContent = bank.label;
    label.setAttribute('aria-hidden', 'true');
    const frames = document.createElement('div');
    frames.className = 'bank-frames';
    for (const scenario of members) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'frame scenario-btn';
      button.dataset.id = scenario.id;
      button.setAttribute('aria-label', scenario.title);
      button.title = scenario.title;
      const title = document.createElement('span');
      title.className = 'frame-title';
      title.textContent = scenario.short;
      button.append(title);
      const subject = STRIP_SUBJECTS[scenario.id];
      if (subject) {
        const line = document.createElement('span');
        line.className = 'frame-subject';
        line.textContent = subject;
        button.append(line);
      }
      button.addEventListener('click', () => {
        if (scenario.id !== activeId) void runScenario(scenario.id, { history: 'push' });
      });
      frames.append(button);
    }
    element.append(label, frames);
    return element;
  });
  listEl.replaceChildren(...banks.filter((bank): bank is HTMLDivElement => bank !== null));
}

function markActive() {
  for (const button of listEl.querySelectorAll<HTMLButtonElement>('.frame')) {
    const active = button.dataset.id === activeId;
    button.classList.toggle('active', active);
    if (active) {
      button.setAttribute('aria-current', 'page');
      button.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    } else {
      button.removeAttribute('aria-current');
    }
  }
}

/** Show a public-API excerpt as a consumer would write it. */
function presentExcerpt(source: string): string {
  return source
    .replace(/from '@src\/index\.js'/g, "from 'surfview'")
    .replace(/from '@src\/controls-ui\/index\.js'/g, "from 'surfview/controls'")
    .replace(/^\/\/ @excerpt-hide[\s\S]*?\/\/ @excerpt-show\n/gm, '')
    .trim();
}

function updateMargin(scenario: Scenario) {
  titleEl.textContent = scenario.title;
  descEl.textContent = scenario.summary;
  syntheticEl.hidden = !scenario.synthetic;
  syntheticEl.textContent = scenario.synthetic ?? '';
  codeBlock.hidden = !scenario.excerpt;
  codeBlock.open = false;
  codeText.textContent = scenario.excerpt ? presentExcerpt(scenario.excerpt) : '';
  codeCopy.textContent = 'Copy';
  document.title = `${scenario.title} · SurfView`;
}

function updateUrl(scenarioId: string, mode: 'push' | 'replace', params?: URLSearchParams) {
  const url = new URL(location.href);
  for (const name of [...url.searchParams.keys()]) url.searchParams.delete(name);
  url.searchParams.set('scenario', scenarioId);
  for (const name of CHAPTER_PARAMS) {
    const value = params?.get(name);
    if (value) url.searchParams.set(name, value);
  }
  history[`${mode}State`](history.state, '', url);
}

function normalizeCleanup(cleanup: ScenarioCleanup): () => Promise<void> {
  let called = false;
  return async () => {
    if (called || !cleanup) return;
    called = true;
    await Promise.resolve(cleanup());
  };
}

async function runScenario(
  id: string,
  options: { history?: 'push' | 'replace' | 'none'; params?: URLSearchParams } = {}
) {
  const scenario = scenarioMap.get(id);
  if (!scenario) return;

  const revision = ++navigationRevision;
  const previousCleanup = activeCleanup;
  activeCleanup = null;
  activeId = scenario.id;
  const params = new URLSearchParams();
  for (const name of CHAPTER_PARAMS) {
    const value = options.params?.get(name);
    if (value) params.set(name, value);
  }
  if (options.history !== 'none') updateUrl(scenario.id, options.history ?? 'push', params);

  const layout = scenario.layout ?? 'standard';
  workspace.dataset.layout = layout;
  app.dataset.scenario = scenario.id;
  updateMargin(scenario);
  markActive();
  perfEl.textContent = '';
  resetBtn.disabled = true;
  setBusy(true, `Loading ${scenario.title}`);

  const mountHost = document.createElement('div');
  mountHost.className = 'scenario-mount';
  mountHost.dataset.scenarioHost = scenario.id;
  const panelHost = document.createElement('div');
  panelHost.className = 'scenario-panel';
  viewerSlot.replaceChildren(mountHost);
  panel.replaceChildren(panelHost);
  film.clear();
  viewerFrame.classList.remove('film-hung');
  void viewerFrame.offsetWidth;
  viewerFrame.classList.add('film-hung');

  if (previousCleanup) {
    try {
      await previousCleanup();
    } catch (error) {
      console.error('Cleanup error', error);
    }
    if (revision !== navigationRevision) return;
  }

  const isCurrent = () => revision === navigationRevision;
  const ctx: ScenarioRunContext = {
    mount: mountHost,
    panel: panelHost,
    film,
    params,
    status: message => { if (isCurrent()) statusEl.textContent = message; },
    perf: message => { if (isCurrent()) perfEl.textContent = message; },
    setBusy: (busy, label) => { if (isCurrent()) setBusy(busy, label); }
  };

  try {
    const cleanup = normalizeCleanup(await scenario.run(ctx));
    if (!isCurrent()) {
      await cleanup();
      return;
    }
    activeCleanup = cleanup;
    statusEl.textContent = `Running: ${scenario.title}`;
    resetBtn.disabled = false;
  } catch (error) {
    if (!isCurrent()) return;
    console.error(error);
    statusEl.textContent = 'Chapter failed to start';
    const message = document.createElement('p');
    message.className = 'scenario-error';
    message.textContent = `This chapter could not start: ${error instanceof Error ? error.message : String(error)}. Reset to try again.`;
    mountHost.replaceChildren(message);
    resetBtn.disabled = false;
  } finally {
    if (isCurrent()) setBusy(false);
  }
}

function openFromLocation(mode: 'replace' | 'none') {
  const query = new URLSearchParams(location.search);
  const target = resolveId(query.get('scenario')) ?? scenarios[0]!.id;
  void runScenario(target, { history: mode, params: query });
}

renderStrip();
resetBtn.addEventListener('click', () => {
  if (activeId) void runScenario(activeId, { history: 'none', params: new URLSearchParams(location.search) });
});
codeCopy.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(codeText.textContent ?? '');
    codeCopy.textContent = 'Copied';
  } catch {
    codeCopy.textContent = 'Select and copy';
  }
});
window.addEventListener('popstate', () => openFromLocation('none'));
window.addEventListener('pagehide', () => {
  navigationRevision++;
  void activeCleanup?.();
  activeCleanup = null;
}, { once: true });
openFromLocation('replace');
