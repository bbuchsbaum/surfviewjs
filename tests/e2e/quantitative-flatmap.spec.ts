import { test, expect } from '@playwright/test';
test('worker, CPU/WebGL field, relief picking and resource ownership agree', async ({ page }) => {
  const errors: string[]=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error') errors.push(m.text());});
  await page.goto('/tests/flatmap-fixture.html');
  await page.waitForFunction(()=> 'flatmapContracts' in window);
  const result=await page.evaluate(async()=>await (window as unknown as {flatmapContracts:()=>Promise<Record<string,unknown>>}).flatmapContracts());
  expect(result.maxValueError).toBeLessThan(1e-12);expect(result.maskDifferences).toBe(0);expect(result.colorError).toBeLessThanOrEqual(1);
  expect(result.stableAfterAnnotation).toBe(true);
  expect(result.exportSnapshot).toBe(true);
  expect(result.drapeColorError).toBeLessThanOrEqual(1);expect(result.contextRestored).toBe(true);expect(result.clippedGpu).toBe(true);expect(result.clippedCpu).toBe(true);
  expect(result.recolorNoBuild).toBe(true);expect(result.frameReuse).toBe(true);expect(result.cancellation).toBe(true);expect(result.commits).toBe(0);
  expect(result.positionsAgree).toBe(true);expect(result.cpuFace).toBe(result.gpuFace);expect(result.anchorUnchanged).toBe(true);
  expect(result.settled).toEqual({resources:0,retainedBytes:0,pendingJobs:0});expect(errors).toEqual([]);
});
