import { parcelMapLab } from './scenarios/parcelMapLab';
let cleanup: (() => void | Promise<void>) | void, closed = false;
void Promise.resolve(parcelMapLab.run({ mount: document.getElementById('map-lab-mount')!, panel: document.getElementById('map-lab-panel')!,
  status: () => {}, perf: () => {}, setBusy: () => {} })).then(dispose => { if (closed) void dispose?.(); else cleanup = dispose; })
  .catch(error => { document.getElementById('map-lab-mount')!.textContent = `The map experiment could not start: ${String(error)}`; });
window.addEventListener('pagehide', () => { closed = true; cleanup?.(); });
