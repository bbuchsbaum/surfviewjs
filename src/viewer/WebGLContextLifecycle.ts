export interface WebGLContextLifecycleCallbacks {
  onLost(): void;
  onRestored(): void;
}

/** Owns WebGL context listener identity and the lost/restored state machine. */
export class WebGLContextLifecycle {
  private lost = false;
  private attached = false;
  private disposed = false;
  private readonly handleLost: EventListener;
  private readonly handleRestored: EventListener;

  constructor(
    private readonly canvas: Pick<HTMLCanvasElement, 'addEventListener' | 'removeEventListener'>,
    private readonly callbacks: WebGLContextLifecycleCallbacks
  ) {
    this.handleLost = event => this.contextLost(event);
    this.handleRestored = () => this.contextRestored();
  }

  attach(): void {
    if (this.disposed || this.attached) return;
    this.canvas.addEventListener('webglcontextlost', this.handleLost);
    this.canvas.addEventListener('webglcontextrestored', this.handleRestored);
    this.attached = true;
  }

  detach(): void {
    if (!this.attached) return;
    this.canvas.removeEventListener('webglcontextlost', this.handleLost);
    this.canvas.removeEventListener('webglcontextrestored', this.handleRestored);
    this.attached = false;
  }

  isLost(): boolean {
    return this.lost;
  }

  dispose(): void {
    if (this.disposed) return;
    this.detach();
    this.disposed = true;
    this.lost = true;
  }

  private contextLost(event: Event): void {
    if (this.disposed) return;
    event.preventDefault();
    if (this.lost) return;
    this.lost = true;
    this.callbacks.onLost();
  }

  private contextRestored(): void {
    if (this.disposed || !this.lost) return;
    this.lost = false;
    this.callbacks.onRestored();
  }
}
