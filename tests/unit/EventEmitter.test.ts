import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from '../../src/EventEmitter';

describe('EventEmitter', () => {
  it('calls listeners on emit', () => {
    const emitter = new EventEmitter();
    const fn = vi.fn();
    emitter.on('test', fn);
    emitter.emit('test', 42);
    expect(fn).toHaveBeenCalledWith(42);
  });

  it('returns an unsubscribe function from on()', () => {
    const emitter = new EventEmitter();
    const fn = vi.fn();
    const unsub = emitter.on('test', fn);
    unsub();
    emitter.emit('test', 'data');
    expect(fn).not.toHaveBeenCalled();
  });

  it('supports multiple listeners', () => {
    const emitter = new EventEmitter();
    const fn1 = vi.fn();
    const fn2 = vi.fn();
    emitter.on('test', fn1);
    emitter.on('test', fn2);
    emitter.emit('test', 'x');
    expect(fn1).toHaveBeenCalledWith('x');
    expect(fn2).toHaveBeenCalledWith('x');
  });

  it('does not call listeners for different events', () => {
    const emitter = new EventEmitter();
    const fn = vi.fn();
    emitter.on('a', fn);
    emitter.emit('b', 'data');
    expect(fn).not.toHaveBeenCalled();
  });

  it('off() removes a specific listener', () => {
    const emitter = new EventEmitter();
    const fn = vi.fn();
    emitter.on('test', fn);
    emitter.off('test', fn);
    emitter.emit('test');
    expect(fn).not.toHaveBeenCalled();
  });

  it('removeAllListeners() clears all events', () => {
    const emitter = new EventEmitter();
    const fn1 = vi.fn();
    const fn2 = vi.fn();
    emitter.on('a', fn1);
    emitter.on('b', fn2);
    emitter.removeAllListeners();
    emitter.emit('a');
    emitter.emit('b');
    expect(fn1).not.toHaveBeenCalled();
    expect(fn2).not.toHaveBeenCalled();
  });

  it('removeAllListeners(event) clears only that event', () => {
    const emitter = new EventEmitter();
    const fn1 = vi.fn();
    const fn2 = vi.fn();
    emitter.on('a', fn1);
    emitter.on('b', fn2);
    emitter.removeAllListeners('a');
    emitter.emit('a');
    emitter.emit('b');
    expect(fn1).not.toHaveBeenCalled();
    expect(fn2).toHaveBeenCalled();
  });

  it('emitting with no listeners does not throw', () => {
    const emitter = new EventEmitter();
    expect(() => emitter.emit('nonexistent', 'data')).not.toThrow();
  });

  it('once() fires listener only once', () => {
    const emitter = new EventEmitter();
    const fn = vi.fn();
    emitter.once('test', fn);
    emitter.emit('test', 'a');
    emitter.emit('test', 'b');
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith('a');
  });

  it('once() returns an unsubscribe function', () => {
    const emitter = new EventEmitter();
    const fn = vi.fn();
    const unsub = emitter.once('test', fn);
    unsub();
    emitter.emit('test');
    expect(fn).not.toHaveBeenCalled();
  });
});
