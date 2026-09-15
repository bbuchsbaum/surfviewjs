import { parcelPuzzle } from './scenarios/parcelPuzzle';

const status = document.getElementById('puzzle-status')!;
let cleanup: (() => void | Promise<void>) | void;
let closed = false;
void Promise.resolve(parcelPuzzle.run({
  mount: document.getElementById('puzzle-mount')!,
  panel: document.getElementById('puzzle-panel')!,
  status: message => { status.textContent = message; },
  perf: () => {}, setBusy: () => {}
})).then(result => { cleanup = result; if (closed) void cleanup?.(); })
  .catch(error => { status.textContent = `Unable to open the puzzle: ${String(error)}`; console.error(error); });
window.addEventListener('pagehide', () => { closed = true; void cleanup?.(); }, { once: true });
