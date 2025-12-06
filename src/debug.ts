export let DEBUG = true; // Enable for debugging surface overlay issues

export function setDebug(value: boolean): void {
  DEBUG = value;
}

export function debugLog(...args: any[]): void {
  if (DEBUG) {
    console.log(...args);
  }
}