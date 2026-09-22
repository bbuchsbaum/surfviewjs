export interface AnimationFrameDriver {
  request(callback: FrameRequestCallback): number;
  cancel(id: number): void;
}

/** Browser driver with no import-time DOM or animation-frame work. */
export const browserAnimationFrameDriver: AnimationFrameDriver = Object.freeze({
  request: (callback: FrameRequestCallback) => requestAnimationFrame(callback),
  cancel: (id: number) => cancelAnimationFrame(id)
});
