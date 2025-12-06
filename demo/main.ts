import './style.css';
import { scenarios } from './manifest';
import type { ScenarioCleanup, ScenarioRunContext } from './types';

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

const scenarioMap = new Map(scenarios.map(s => [s.id, s]));
let activeCleanup: ScenarioCleanup | null = null;
let activeId: string | null = null;

function updateStatus(message: string) {
  if (statusEl) statusEl.textContent = message;
}

function updatePerf(message: string) {
  if (perfEl) perfEl.textContent = message;
}

function setBusy(busy: boolean, label?: string) {
  viewerFrame?.classList.toggle('busy', busy);
  if (label) updateStatus(label);
}

function renderList(filter = '') {
  if (!listEl) return;
  listEl.innerHTML = '';
  const needle = filter.trim().toLowerCase();

  scenarios
    .filter(s => !needle || s.title.toLowerCase().includes(needle) || s.tags.some(t => t.includes(needle)))
    .forEach(scenario => {
      const btn = document.createElement('button');
      btn.className = 'scenario-btn';
      if (scenario.id === activeId) btn.classList.add('active');
      btn.dataset.id = scenario.id;
      btn.innerHTML = `
        <div class="scenario-title">${scenario.title}</div>
        <div class="scenario-desc">${scenario.description}</div>
        <div class="scenario-tags">
          ${scenario.tags.map(t => `<span class="tag">${t}</span>`).join('')}
        </div>
      `;
      btn.addEventListener('click', () => {
        runScenario(scenario.id);
      });
      listEl.appendChild(btn);
    });
}

function updateHeader(scenarioId: string) {
  const scenario = scenarioMap.get(scenarioId);
  if (!scenario) {
    if (titleEl) titleEl.textContent = 'Pick a scenario';
    if (descEl) descEl.textContent = 'Load a scenario from the left menu to spin up a viewer.';
    if (tagsEl) tagsEl.textContent = '';
    return;
  }
  if (titleEl) titleEl.textContent = scenario.title;
  if (descEl) descEl.textContent = scenario.description;
  if (tagsEl) tagsEl.textContent = scenario.tags.join(' | ');
}

async function runScenario(id: string) {
  const scenario = scenarioMap.get(id);
  if (!scenario || !viewerSlot || !panel) {
    return;
  }

  resetBtn?.setAttribute('disabled', 'true');
  setBusy(true, `Loading ${scenario.title}`);

  if (activeCleanup) {
    try {
      await Promise.resolve(activeCleanup());
    } catch (err) {
      console.error('Cleanup error', err);
    }
  }

  panel.innerHTML = '<div class="panel-empty">Scenario controls will appear here.</div>';
  activeId = scenario.id;
  updateHeader(activeId);
  renderList(searchEl?.value || '');

  const ctx: ScenarioRunContext = {
    mount: viewerSlot,
    panel,
    status: updateStatus,
    perf: updatePerf,
    setBusy
  };

  try {
    const cleanup = await scenario.run(ctx);
    activeCleanup = cleanup || null;
    updateStatus(`Running: ${scenario.title}`);
    resetBtn?.removeAttribute('disabled');
  } catch (err) {
    console.error(err);
    updateStatus('Scenario failed to start');
    activeCleanup = null;
  } finally {
    setBusy(false);
    renderList(searchEl?.value || '');
  }
}

function bootstrap() {
  renderList();
  updateHeader('');

  searchEl?.addEventListener('input', () => {
    renderList(searchEl.value);
  });

  resetBtn?.addEventListener('click', () => {
    if (activeId) {
      runScenario(activeId);
    }
  });

  // Start with the first scenario for quick sanity checks
  if (scenarios.length > 0) {
    runScenario(scenarios[0].id);
  }
}

bootstrap();
