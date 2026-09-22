export type EventListener = (...args: unknown[]) => void;
export type UnsubscribeFn = () => void;

export type EventPayloadArgs<Payload> = [Payload] extends [void] ? [] : [payload: Payload];
export type TypedEventListener<Payload> = [Payload] extends [void] ? () => void : (payload: Payload) => void;
export type EventType<Events> = Extract<keyof Events, string>;
export type EventListenerFor<Events, K extends EventType<Events>> = TypedEventListener<Events[K]>;
export type EventArgsFor<Events, K extends EventType<Events>> = EventPayloadArgs<Events[K]>;

export class EventEmitter<Events extends object = Record<never, never>> {
  private _events: Record<string, EventListener[]>;

  constructor() {
    // Use an object without a prototype to avoid prototype pollution
    this._events = Object.create(null);
  }

  on<K extends EventType<Events>>(event: K, listener: EventListenerFor<Events, K>): UnsubscribeFn {
    if (typeof listener !== 'function') {
      throw new TypeError('listener must be a function');
    }
    if (!this._events[event]) {
      this._events[event] = [];
    }
    const eventListener = listener as EventListener;
    this._events[event].push(eventListener);
    return () => this.removeStoredListener(event, eventListener);
  }

  once<K extends EventType<Events>>(event: K, listener: EventListenerFor<Events, K>): UnsubscribeFn {
    if (typeof listener !== 'function') {
      throw new TypeError('listener must be a function');
    }
    const wrapped: EventListener = (...args) => {
      this.removeStoredListener(event, wrapped);
      (listener as EventListener)(...args);
    };
    return this.on(event, wrapped as EventListenerFor<Events, K>);
  }

  emit<K extends EventType<Events>>(event: K, ...args: EventArgsFor<Events, K>): void {
    if (this._events[event]) {
      // Copy listeners to avoid issues if the array is modified during emit
      let failure: unknown;
      let failed = false;
      for (const listener of [...this._events[event]]) {
        try {
          listener(...args);
        } catch (error) {
          if (!failed) {
            failed = true;
            failure = error;
          }
        }
      }
      if (failed) throw failure;
    }
  }

  removeListener<K extends EventType<Events>>(
    event: K,
    listenerToRemove: EventListenerFor<Events, K>
  ): void {
    if (this._events[event]) {
      const eventListener = listenerToRemove as EventListener;
      this._events[event] = this._events[event].filter(
        (listener) => listener !== eventListener
      );
      if (this._events[event].length === 0) {
        delete this._events[event];
      }
    }
  }

  removeAllListeners(event?: EventType<Events>): void {
    if (event) {
      delete this._events[event];
    } else {
      this._events = Object.create(null);
    }
  }

  // Alias for removeListener
  off<K extends EventType<Events>>(event: K, listener: EventListenerFor<Events, K>): void {
    return this.removeListener(event, listener);
  }

  private removeStoredListener(event: string, listenerToRemove: EventListener): void {
    if (this._events[event]) {
      this._events[event] = this._events[event].filter(
        (listener) => listener !== listenerToRemove
      );
      if (this._events[event].length === 0) {
        delete this._events[event];
      }
    }
  }
}

/**
 * Explicitly dynamic event channel for plugin protocols discovered at runtime.
 * Core SurfViewJS objects use `EventEmitter<EventMap>` instead.
 */
export class DynamicEventEmitter {
  private _events: Record<string, EventListener[]> = Object.create(null);

  on(event: string, listener: EventListener): UnsubscribeFn {
    if (typeof listener !== 'function') throw new TypeError('listener must be a function');
    (this._events[event] ??= []).push(listener);
    return () => this.removeListener(event, listener);
  }

  once(event: string, listener: EventListener): UnsubscribeFn {
    if (typeof listener !== 'function') throw new TypeError('listener must be a function');
    const wrapped: EventListener = (...args) => {
      this.removeListener(event, wrapped);
      listener(...args);
    };
    return this.on(event, wrapped);
  }

  emit(event: string, ...args: unknown[]): void {
    let failure: unknown;
    let failed = false;
    for (const listener of [...(this._events[event] ?? [])]) {
      try {
        listener(...args);
      } catch (error) {
        if (!failed) {
          failed = true;
          failure = error;
        }
      }
    }
    if (failed) throw failure;
  }

  removeListener(event: string, listenerToRemove: EventListener): void {
    const listeners = this._events[event];
    if (!listeners) return;
    this._events[event] = listeners.filter(listener => listener !== listenerToRemove);
    if (this._events[event].length === 0) delete this._events[event];
  }

  off(event: string, listener: EventListener): void {
    this.removeListener(event, listener);
  }

  removeAllListeners(event?: string): void {
    if (event === undefined) this._events = Object.create(null);
    else delete this._events[event];
  }
}
