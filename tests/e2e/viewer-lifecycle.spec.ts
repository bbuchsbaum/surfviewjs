import { expect, test } from '@playwright/test';

test('viewer becomes idle, recovers one frame after context loss, and stays silent after disposal', async ({ page }) => {
  await page.goto('/tests/index.html');

  const result = await page.evaluate(async () => {
    const nativeRequestAnimationFrame = window.requestAnimationFrame.bind(window);
    const nativeCancelAnimationFrame = window.cancelAnimationFrame.bind(window);
    let nextFrameId = 0;
    let requestCount = 0;
    let executionCount = 0;
    const pendingFrames = new Map<number, number>();

    window.requestAnimationFrame = (callback: FrameRequestCallback): number => {
      const frameId = ++nextFrameId;
      requestCount += 1;
      const nativeId = nativeRequestAnimationFrame((timestamp) => {
        pendingFrames.delete(frameId);
        executionCount += 1;
        callback(timestamp);
      });
      pendingFrames.set(frameId, nativeId);
      return frameId;
    };
    window.cancelAnimationFrame = (frameId: number): void => {
      const nativeId = pendingFrames.get(frameId);
      if (nativeId === undefined) return;
      pendingFrames.delete(frameId);
      nativeCancelAnimationFrame(nativeId);
    };

    const delay = (milliseconds: number) => new Promise(resolve => setTimeout(resolve, milliseconds));
    const waitForViewerEvent = (
      viewer: { once: (name: string, listener: () => void) => () => void },
      name: string,
      timeoutMs = 3000
    ) => new Promise<void>((resolve, reject) => {
      const timeoutId = window.setTimeout(() => {
        unsubscribe();
        reject(new Error(`Timed out waiting for ${name}`));
      }, timeoutMs);
      const unsubscribe = viewer.once(name, () => {
        window.clearTimeout(timeoutId);
        resolve();
      });
    });

    let viewer: any = null;
    try {
      const { NeuroSurfaceViewer } = await import('/src/index.ts');
      const mount = document.createElement('div');
      mount.style.width = '320px';
      mount.style.height = '240px';
      document.body.replaceChildren(mount);
      viewer = new NeuroSurfaceViewer(mount, 320, 240, {
        controlType: 'surface',
        backgroundColor: 0x000000
      });

      let renders = 0;
      viewer.on('render:after', () => {
        renders += 1;
      });
      viewer.startRenderLoop();
      await delay(120);
      const settled = {
        pendingFrames: pendingFrames.size,
        requests: requestCount,
        executions: executionCount,
        renders
      };

      const context = viewer.renderer.getContext();
      const loseContext = context.getExtension('WEBGL_lose_context');
      if (!loseContext) {
        throw new Error('WEBGL_lose_context is required for lifecycle recovery evidence');
      }

      const lost = waitForViewerEvent(viewer, 'context:lost');
      loseContext.loseContext();
      await lost;
      viewer.requestRender();
      await delay(50);
      const whileLost = {
        pendingFrames: pendingFrames.size,
        renders
      };

      const restored = waitForViewerEvent(viewer, 'context:restored');
      const restoredPaint = waitForViewerEvent(viewer, 'render:after');
      loseContext.restoreContext();
      await restored;
      await restoredPaint;
      await delay(80);
      const afterRestore = {
        pendingFrames: pendingFrames.size,
        renders
      };

      const beforeInvalidation = renders;
      viewer.requestRender();
      viewer.requestRender();
      viewer.requestRender();
      await waitForViewerEvent(viewer, 'render:after');
      await delay(80);
      const coalescedRenderCount = renders - beforeInvalidation;

      viewer.requestRender();
      const pendingBeforeDispose = pendingFrames.size;
      viewer.dispose();
      const requestsAtDispose = requestCount;
      const rendersAtDispose = renders;
      viewer.start();
      viewer.startRenderLoop();
      viewer.requestRender();
      viewer.renderer.domElement.dispatchEvent(new Event('webglcontextrestored'));
      await delay(100);
      const afterDispose = {
        pendingBeforeDispose,
        pendingFrames: pendingFrames.size,
        requestDelta: requestCount - requestsAtDispose,
        renderDelta: renders - rendersAtDispose,
        canvasAttached: mount.contains(viewer.renderer.domElement)
      };

      return { settled, whileLost, afterRestore, coalescedRenderCount, afterDispose };
    } finally {
      viewer?.dispose();
      for (const nativeId of pendingFrames.values()) {
        nativeCancelAnimationFrame(nativeId);
      }
      pendingFrames.clear();
      window.requestAnimationFrame = nativeRequestAnimationFrame;
      window.cancelAnimationFrame = nativeCancelAnimationFrame;
    }
  });

  expect(result.settled.pendingFrames).toBe(0);
  expect(result.settled.executions).toBeGreaterThanOrEqual(1);
  expect(result.settled.renders).toBeGreaterThanOrEqual(1);
  expect(result.whileLost.pendingFrames).toBe(0);
  expect(result.afterRestore.pendingFrames).toBe(0);
  expect(result.afterRestore.renders).toBe(result.whileLost.renders + 1);
  expect(result.coalescedRenderCount).toBe(1);
  expect(result.afterDispose).toEqual({
    pendingBeforeDispose: 1,
    pendingFrames: 0,
    requestDelta: 0,
    renderDelta: 0,
    canvasAttached: false
  });
});
