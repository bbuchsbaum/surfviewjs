export let DEBUG = false;

export function setDebug(value: boolean): void {
  DEBUG = value;
}

export function debugLog(...args: any[]): void {
  if (DEBUG) {
    console.log(...args);
  }
}