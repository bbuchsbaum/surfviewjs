import { browserAnimationFrameDriver } from '../viewer/AnimationFrameDriver';
import type { AnimationFrameDriver } from '../viewer/AnimationFrameDriver';

export interface SurfaceColorUpdateHost {
  needsComposite(): boolean;
  updateColors(): void;
  onRenderNeeded(): void;
}

/** Coalesces surface color work while allowing the viewer to flush before paint. */
export class SurfaceColorUpdateScheduler {
  private pending = false;
  private frameId: number | null = null;
  private disposed = false;
  private readonly runFrame: FrameRequestCallback;

  constructor(
    private readonly host: SurfaceColorUpdateHost,
    private readonly frameDriver: AnimationFrameDriver = browserAnimationFrameDriver
  ) {
    this.runFrame = () => {
      this.frameId = null;
      this.flush();
    };
  }

  request(): void {
    if (this.disposed || this.pending) return;
    this.pending = true;
    this.frameId = this.frameDriver.request(this.runFrame);
  }

  flush(): boolean {
    if (this.disposed || (!this.pending && !this.host.needsComposite())) return false;
    if (this.frameId !== null) {
      this.frameDriver.cancel(this.frameId);
      this.frameId = null;
    }
    this.pending = false;
    this.host.updateColors();
    this.host.onRenderNeeded();
    return true;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.frameId !== null) this.frameDriver.cancel(this.frameId);
    this.frameId = null;
    this.pending = false;
  }
}
