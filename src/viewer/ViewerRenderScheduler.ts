import {
  browserAnimationFrameDriver
} from './AnimationFrameDriver';
import type { AnimationFrameDriver } from './AnimationFrameDriver';

export interface ViewerRenderSchedulerHost {
  canInvalidate(): boolean;
  canRun(): boolean;
  updateControls(): void;
  render(): void;
  controlsHaveDamping(): boolean;
  onRenderNeeded(): void;
}

export interface ViewerRenderSchedulerOptions {
  initiallyDirty?: boolean;
  frameDriver?: AnimationFrameDriver;
}

/** Owns the viewer's sole on-demand animation-frame lifecycle. */
export class ViewerRenderScheduler {
  pendingFrameId: number | null = null;
  needsRender: boolean;
  private paused = false;
  private frameRunning = false;
  private controlsInteractionActive = false;
  private controlsSettling = false;
  private controlsChangedDuringFrame = false;
  private disposed = false;
  private readonly frameDriver: AnimationFrameDriver;
  private readonly runFrameCallback: FrameRequestCallback;

  constructor(
    private readonly host: ViewerRenderSchedulerHost,
    options: ViewerRenderSchedulerOptions = {}
  ) {
    this.needsRender = options.initiallyDirty ?? false;
    this.frameDriver = options.frameDriver ?? browserAnimationFrameDriver;
    this.runFrameCallback = () => this.runFrame();
  }

  requestRender(): void {
    if (this.disposed || !this.host.canInvalidate()) return;
    const shouldNotify = !this.needsRender;
    this.needsRender = true;
    this.schedule();
    if (shouldNotify) this.host.onRenderNeeded();
  }

  noteControlsChanged(): void {
    if (this.frameRunning) this.controlsChangedDuringFrame = true;
  }

  beginControlsInteraction(): void {
    if (this.disposed) return;
    this.controlsInteractionActive = true;
    this.controlsSettling = this.host.controlsHaveDamping();
    this.requestRender();
  }

  endControlsInteraction(): void {
    if (this.disposed) return;
    this.controlsInteractionActive = false;
    this.controlsSettling = this.host.controlsHaveDamping();
    this.requestRender();
  }

  runFrame(): void {
    this.pendingFrameId = null;
    if (!this.canSchedule()) return;

    this.frameRunning = true;
    this.controlsChangedDuringFrame = false;
    try {
      this.host.updateControls();
      if (this.needsRender) {
        // Clear first so a render listener invalidation schedules one follow-up.
        this.needsRender = false;
        this.host.render();
      }
    } finally {
      this.frameRunning = false;
    }

    const controlsNeedAnotherFrame = this.controlsInteractionActive ||
      (this.controlsSettling && this.controlsChangedDuringFrame);
    this.controlsSettling = controlsNeedAnotherFrame && this.host.controlsHaveDamping();
    if (this.needsRender || controlsNeedAnotherFrame) this.schedule();
  }

  start(): void {
    if (this.disposed) return;
    this.paused = false;
    this.requestRender();
  }

  stop(): void {
    this.paused = true;
    this.controlsInteractionActive = false;
    this.controlsSettling = false;
    this.cancelPendingFrame();
  }

  cancelPendingFrame(): void {
    if (this.pendingFrameId === null) return;
    this.frameDriver.cancel(this.pendingFrameId);
    this.pendingFrameId = null;
  }

  dispose(): void {
    if (this.disposed) return;
    this.stop();
    this.disposed = true;
    this.needsRender = false;
  }

  private schedule(): void {
    if (!this.canSchedule() || this.frameRunning || this.pendingFrameId !== null) return;
    this.pendingFrameId = this.frameDriver.request(this.runFrameCallback);
  }

  private canSchedule(): boolean {
    return !this.disposed && !this.paused && this.host.canRun();
  }
}
