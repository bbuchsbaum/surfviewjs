export type EventListener = (...args: any[]) => void;
export type UnsubscribeFn = () => void;

export class EventEmitter {
  private _events: Record<string, EventListener[]>;

  constructor() {
    // Use an object without a prototype to avoid prototype pollution
    this._events = Object.create(null);
  }

  on(event: string, listener: EventListener): UnsubscribeFn {
    if (typeof listener !== 'function') {
      throw new TypeError('listener must be a function');
    }
    if (!this._events[event]) {
      this._events[event] = [];
    }
    this._events[event].push(listener);
    return () => this.removeListener(event, listener);
  }

  once(event: string, listener: EventListener): UnsubscribeFn {
    if (typeof listener !== 'function') {
      throw new TypeError('listener must be a function');
    }
    const wrapped: EventListener = (...args) => {
      this.removeListener(event, wrapped);
      listener(...args);
    };
    return this.on(event, wrapped);
  }

  emit(event: string, ...args: any[]): void {
    if (this._events[event]) {
      // Copy listeners to avoid issues if the array is modified during emit
      [...this._events[event]].forEach((listener) => listener(...args));
    }
  }

  removeListener(event: string, listenerToRemove: EventListener): void {
    if (this._events[event]) {
      this._events[event] = this._events[event].filter(
        (listener) => listener !== listenerToRemove
      );
      if (this._events[event].length === 0) {
        delete this._events[event];
      }
    }
  }

  removeAllListeners(event?: string): void {
    if (event) {
      delete this._events[event];
    } else {
      this._events = Object.create(null);
    }
  }

  // Alias for removeListener
  off(event: string, listener: EventListener): void {
    return this.removeListener(event, listener);
  }
}