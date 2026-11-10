import { checkBudget, GeometryError } from '../geometry/GeometryError';

/** Byte-bounded LRU. Optional disposal is called exactly once when an owned entry leaves. */
export class FlatMapTileCache<T> {
  private entries = new Map<string, { value: T; bytes: number }>();
  private used = 0;
  constructor(readonly budgetBytes: number, private readonly disposeEntry?: (value: T) => void) { checkBudget(0, budgetBytes); }
  get byteLength(): number { return this.used; }
  get size(): number { return this.entries.size; }
  get(key: string): T | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    this.entries.delete(key); this.entries.set(key, entry); return entry.value;
  }
  set(key: string, value: T, bytes: number): void {
    checkBudget(bytes, this.budgetBytes);
    const prior = this.entries.get(key);
    if (prior?.value === value) {
      if (prior.bytes !== bytes) throw new GeometryError('invalid-shape', 'Cached value byte count cannot change');
      this.get(key); return;
    }
    this.delete(key);
    while (this.used + bytes > this.budgetBytes) this.delete(this.entries.keys().next().value!);
    this.entries.set(key, { value, bytes }); this.used += bytes;
  }
  delete(key: string): void {
    const entry = this.entries.get(key);
    if (!entry) return;
    this.entries.delete(key); this.used -= entry.bytes; this.disposeEntry?.(entry.value);
  }
  clear(): void { for (const key of this.entries.keys()) this.delete(key); }
}
