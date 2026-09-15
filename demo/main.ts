import './style.css';
import { scenarios } from './manifest';
import type { Scenario, ScenarioCleanup, ScenarioRunContext } from './types';

const app = document.getElementById('app');
const workspace = document.querySelector<HTMLElement>('.workspace');
const listEl = document.getElementById('scenario-list');
const searchEl = document.getElementById('scenario-search') as HTMLInputElement | null;
const statusEl = document.getElementById('status-text');
const perfEl = document.getElementById('perf-text');
const titleEl = document.getElementById('active-title');
const descEl = document.getElementById('active-desc');
const tagsEl = document.getElementById('active-tags');
const resetBtn = document.getElementById('reset-btn') as HTMLButtonElement | null;
const viewerSlot = document.getElementById('viewer-slot');
const panel = document.getElementById('panel');
const viewerFrame = document.getElementById('viewer-frame');

const scenarioMap = new Map(scenarios.map(scenario => [scenario.id, scenario]));
const featuredPresets: Array<{
  scenarioId: string;
  title: string;
  description: string;
  params: Record<string, string>;
}> = [
  {
    scenarioId: 'atlas-illustration',
    title: 'Glasser atlas plates',
    description: 'Publication-oriented HCP–MMP1.0 plates with labels, provenance, and vector export.',
    params: { atlas: 'glasser' }
  },
  {
    scenarioId: 'parcel-puzzle',
    title: 'Glasser parcel puzzle',
    description: 'Inspect 180 HCP–MMP1.0 regions as separable, rotatable pieces on real fsLR geometry.',
    params: { atlas: 'glasser' }
  },
  {
    scenarioId: 'parcel-map-lab',
    title: '2D parcel map laboratory',
    description: 'Flatten Glasser or Schaefer parcels into a connected map and inspect the tradeoffs.',
    params: { dataset: 'glasser' }
  }
];

let activeCleanup: (() => Promise<void>) | null = null;
let activeId: string | null = null;
let navigationRevision = 0;

function updateStatus(message: string) {
  if (statusEl) statusEl.textContent = message;
}

function updatePerf(message: string) {
  if (perfEl) perfEl.textContent = message;
}

function setBusy(busy: boolean, label?: string) {
  viewerFrame?.classList.toggle('busy', busy);
  viewerFrame?.setAttribute('aria-busy', String(busy));
  if (label) updateStatus(label);
}

function scenarioMatches(scenario: Scenario, needle: string): boolean {
  const searchable = [scenario.title, scenario.description, ...scenario.tags].join(' ').toLowerCase();
  return searchable.includes(needle);
}

function presetIsActive(scenarioId: string, params: Record<string, string>): boolean {
  if (activeId !== scenarioId) return false;
  const query = new URLSearchParams(location.search);
  return Object.entries(params).every(([name, value]) => query.get(name) === value);
}

function createScenarioButton(
  scenario: Scenario,
  copy: { title: string; description: string },
  params?: Record<string, string>,
  featured = false
): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `scenario-btn${featured ? ' scenario-btn-featured' : ''}`;
  const isActive = params ? presetIsActive(scenario.id, params) : scenario.id === activeId;
  button.classList.toggle('active', isActive);
  if (isActive) button.setAttribute('aria-current', 'page');
  button.dataset.id = scenario.id;

  const title = document.createElement('span');
  title.className = 'scenario-title';
  title.textContent = copy.title;
  const description = document.createElement('span');
  description.className = 'scenario-desc';
  description.textContent = copy.description;
  const tags = document.createElement('span');
  tags.className = 'scenario-tags';
  for (const tagName of scenario.tags.slice(0, featured ? 3 : 4)) {
    const tag = document.createElement('span');
    tag.className = 'tag';
    tag.textContent = tagName;
    tags.append(tag);
  }
  button.append(title, description, tags);
  button.addEventListener('click', () => {
    void runScenario(scenario.id, { history: 'push', params });
  });
  return button;
}

function appendGroup(title: string, buttons: HTMLButtonElement[]) {
  if (!listEl || buttons.length === 0) return;
  const heading = document.createElement('div');
  heading.className = 'scenario-group-title';
  heading.textContent = title;
  listEl.append(heading, ...buttons);
}

function renderList(filter = '') {
  if (!listEl) return;
  listEl.replaceChildren();
  const needle = filter.trim().toLowerCase();
  const featuredButtons = featuredPresets.flatMap(preset => {
    const scenario = scenarioMap.get(preset.scenarioId);
    if (!scenario) return [];
    const searchable = `${preset.title} ${preset.description} ${scenario.tags.join(' ')}`.toLowerCase();
    if (needle && !searchable.includes(needle)) return [];
    return [createScenarioButton(scenario, preset, preset.params, true)];
  });
  const scenarioButtons = scenarios
    .filter(scenario => !needle || scenarioMatches(scenario, needle))
    .map(scenario => createScenarioButton(scenario, scenario));

  appendGroup('Featured atlas tools', featuredButtons);
  appendGroup(needle ? 'Matching scenarios' : 'All scenarios', scenarioButtons);
  if (listEl.childElementCount === 0) {
    const empty = document.createElement('p');
    empty.className = 'scenario-empty';
    empty.textContent = 'No scenarios match this search.';
    listEl.append(empty);
  }
}

function updateHeader(scenarioId: string) {
  const scenario = scenarioMap.get(scenarioId);
  if (!scenario) {
    if (titleEl) titleEl.textContent = 'Pick a scenario';
    if (descEl) descEl.textContent = 'Choose a demonstration from the navigation.';
    if (tagsEl) tagsEl.textContent = '';
    return;
  }
  if (titleEl) titleEl.textContent = scenario.title;
  if (descEl) descEl.textContent = scenario.description;
  if (tagsEl) tagsEl.textContent = scenario.tags.join(' · ');
}

function updateScenarioUrl(
  scenarioId: string,
  mode: 'push' | 'replace',
  params?: Record<string, string>,
  preserveRelevantParam = false
) {
  const url = new URL(location.href);
  const relevantName = scenarioId === 'parcel-puzzle' || scenarioId === 'atlas-illustration'
    ? 'atlas'
    : scenarioId === 'parcel-map-lab' ? 'dataset' : null;
  const preservedValue = preserveRelevantParam && relevantName ? url.searchParams.get(relevantName) : null;
  url.searchParams.set('scenario', scenarioId);
  url.searchParams.delete('atlas');
  url.searchParams.delete('dataset');
  if (relevantName && preservedValue) url.searchParams.set(relevantName, preservedValue);
  for (const [name, value] of Object.entries(params ?? {})) url.searchParams.set(name, value);
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

function applyLayout(scenario: Scenario) {
  const layout = scenario.layout ?? 'standard';
  if (workspace) workspace.dataset.layout = layout;
  if (app) app.dataset.scenario = scenario.id;
  if (panel) {
    panel.hidden = layout === 'wide';
    panel.setAttribute('aria-hidden', String(layout === 'wide'));
  }
}

async function runScenario(
  id: string,
  options: {
    history?: 'push' | 'replace' | 'none';
    params?: Record<string, string>;
    preserveRelevantParam?: boolean;
  } = {}
) {
  const scenario = scenarioMap.get(id);
  if (!scenario || !viewerSlot || !panel) return;

  const revision = ++navigationRevision;
  const previousCleanup = activeCleanup;
  activeCleanup = null;
  activeId = scenario.id;
  if (options.history !== 'none') {
    updateScenarioUrl(scenario.id, options.history ?? 'push', options.params, options.preserveRelevantParam);
  }
  applyLayout(scenario);
  updateHeader(activeId);
  renderList(searchEl?.value || '');
  updatePerf('');
  resetBtn?.setAttribute('disabled', 'true');
  setBusy(true, `Loading ${scenario.title}`);

  const mountHost = document.createElement('div');
  mountHost.className = 'scenario-mount';
  mountHost.dataset.scenarioHost = scenario.id;
  const panelHost = document.createElement('div');
  panelHost.className = 'scenario-panel';
  panelHost.innerHTML = '<div class="panel-empty">Scenario controls will appear here.</div>';
  viewerSlot.replaceChildren(mountHost);
  panel.replaceChildren(panelHost);

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
    status: message => { if (isCurrent()) updateStatus(message); },
    perf: message => { if (isCurrent()) updatePerf(message); },
    setBusy: (busy, label) => { if (isCurrent()) setBusy(busy, label); }
  };

  try {
    const cleanup = normalizeCleanup(await scenario.run(ctx));
    if (!isCurrent()) {
      await cleanup();
      return;
    }
    activeCleanup = cleanup;
    updateStatus(`Running: ${scenario.title}`);
    resetBtn?.removeAttribute('disabled');
  } catch (error) {
    if (!isCurrent()) return;
    console.error(error);
    updateStatus('Scenario failed to start');
    mountHost.innerHTML = '<p class="scenario-error">This scenario could not be started. Check the console for details.</p>';
  } finally {
    if (isCurrent()) {
      setBusy(false);
      renderList(searchEl?.value || '');
    }
  }
}

function bootstrap() {
  renderList();
  updateHeader('');

  searchEl?.addEventListener('input', () => renderList(searchEl.value));
  workspace?.addEventListener('change', event => {
    const target = event.target;
    if (target instanceof Element && target.matches('#atlas-dataset, [aria-label="Puzzle atlas"], [aria-label="Map dataset"]')) {
      renderList(searchEl?.value || '');
    }
  });
  resetBtn?.addEventListener('click', () => {
    if (activeId) void runScenario(activeId, { history: 'none' });
  });
  window.addEventListener('popstate', () => {
    const requested = new URLSearchParams(location.search).get('scenario');
    const target = requested && scenarioMap.has(requested) ? requested : scenarios[0]?.id;
    if (target) void runScenario(target, { history: 'none' });
  });
  window.addEventListener('pagehide', () => {
    navigationRevision++;
    void activeCleanup?.();
    activeCleanup = null;
  }, { once: true });

  const requestedScenario = new URLSearchParams(location.search).get('scenario');
  const initialScenario = requestedScenario && scenarioMap.has(requestedScenario)
    ? requestedScenario
    : scenarios[0]?.id;
  if (initialScenario) {
    void runScenario(initialScenario, {
      history: 'replace',
      preserveRelevantParam: requestedScenario === initialScenario
    });
  }
}

bootstrap();
