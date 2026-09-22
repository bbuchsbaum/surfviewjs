export let DEBUG = false;

export function setDebug(value: boolean): void {
  DEBUG = value;
}

export function isDebugEnabled(): boolean {
  return DEBUG;
}

export function debugLog(...args: any[]): void {
  if (DEBUG) {
    console.log(...args);
  }
}
