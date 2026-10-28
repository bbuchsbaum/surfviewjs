import { chromium } from '@playwright/test';
import { writeFile, readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const base=process.env.BASE_URL??'http://127.0.0.1:4192',output=process.argv[2]??'/tmp/surfview-browser-geometry.json';
const launch={headless:process.env.GEOMETRY_HEADED!=='1',...(process.env.GEOMETRY_GPU_PROFILE==='metal'?{args:['--use-angle=metal']}: {})};
const sha=async path=>createHash('sha256').update(await readFile(path)).digest('hex');
const sourceFiles=await readdir(new URL('../src/',import.meta.url),{recursive:true});
const sourceHashes=Object.fromEntries(await Promise.all(sourceFiles.filter(p=>/\.(ts|js)$/.test(p)).sort().map(async p=>[p,await sha(new URL('../src/'+p,import.meta.url))])));
const browser=await chromium.launch(launch);
try {
 const page=await browser.newPage({viewport:{width:800,height:800}}),errors=[];
 page.on('pageerror',error=>errors.push(error.message));
 await page.goto(base+'/tests/geometry-performance.html');await page.waitForFunction(()=>window.geometryPerformanceReady);
 const report=await page.evaluate(()=>window.geometryPerformance());
 report.browserVersion=browser.version();report.launch=launch;report.userAgent=await page.evaluate(()=>navigator.userAgent);
 report.runtime={workerSha256:await sha(new URL('../dist/surfview.geometry.worker.js',import.meta.url)),sourceTreeSha256:createHash('sha256').update(JSON.stringify(sourceHashes)).digest('hex'),sourceHashes};
 report.fixtureSha256=createHash('sha256').update(await readFile(new URL('../tests/geometry-performance.html',import.meta.url))).digest('hex');
 report.witnesses={pageErrors:errors,dynamicMask:report.maxDynamicMaskDifference<=1e-12,cancelled:report.cancellation.cancelled,pixels:report.nonblackPixels>0,frameChanged:report.frameHashes[0]!==report.frameHashes[1]};
 await writeFile(output,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
 if(errors.length||!report.witnesses.dynamicMask||!report.witnesses.cancelled||!report.witnesses.pixels||!report.witnesses.frameChanged)throw new Error('Browser witness failed; raw measurements retained');
} finally { await browser.close(); }
