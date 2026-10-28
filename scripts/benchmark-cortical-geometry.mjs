import { readFile, writeFile, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { JSDOM } from 'jsdom';
import { parseGIfTISurface, SurfaceDomain, SurfaceMetric, buildSurfaceSmoothingPlan } from '../dist/surfview.es.js';
const output = process.argv.find(x => x.startsWith('--output='))?.slice(9) ?? '/tmp/surfview-cortical-benchmark.json';
const level = process.argv.find(x => x.startsWith('--level='))?.slice(8);
if (level === undefined) {
  const cases = [];
  for (const l of process.env.CORTICAL_MESH ? [0] : [0,1,2]) for (const fwhm of [2,4,8]) {
    const file = `${output}.${l}-${fwhm}.case.json`;
    await rm(file, { force: true });
    const child = spawnSync(process.execPath, ['--expose-gc', import.meta.filename, `--level=${l}`, `--fwhm=${fwhm}`, `--output=${file}`], { timeout: 180000, encoding: 'utf8', maxBuffer: 1024*1024 });
    try { cases.push(JSON.parse(await readFile(file,'utf8'))); } catch { cases.push({ level:l, fwhm, failure:child.error?.message ?? child.stderr, status:child.status }); }
    console.log(`level ${l} FWHM ${fwhm}: ${cases.at(-1).error ?? cases.at(-1).vertices ?? 'failed'}`);
    await writeFile(output,JSON.stringify({runtime:process.version, hardware:{platform:os.platform(),arch:os.arch(),cpu:os.cpus()[0]?.model,totalMemoryBytes:os.totalmem()}, fixture:process.env.CORTICAL_MESH ?? 'Bundled fsaverage5-lh-pial; levels 1 and 2 use planar midpoint subdivision, preserving its piecewise-linear cortex. These are density stress fixtures, not independent fsaverage6/7 acquisitions.', coldBuildSamples:1, cases},null,2)+'\n');
  }
} else {
  const input = await readFile(process.env.CORTICAL_MESH ?? new URL('../tests/data/fsaverage5-lh-pial.gii',import.meta.url));
  const parsed = parseGIfTISurface(input.toString(),new JSDOM().window.DOMParser);
  let positions = [...parsed.vertices], faces = [...parsed.faces];
  for(let pass=0;pass<Number(level);pass++) {
    const mids=new Map(),next=[];
    const mid=(a,b)=>{const key=`${Math.min(a,b)}:${Math.max(a,b)}`;if(mids.has(key))return mids.get(key);const v=positions.length/3;for(let j=0;j<3;j++)positions.push((positions[a*3+j]+positions[b*3+j])/2);mids.set(key,v);return v;};
    for(let i=0;i<faces.length;i+=3){const [a,b,c]=faces.slice(i,i+3),ab=mid(a,b),bc=mid(b,c),ca=mid(c,a);next.push(a,ab,ca,ab,b,bc,ca,bc,c,ab,bc,ca);}faces=next;
  }
  const domain=new SurfaceDomain({id:`cortex-${level}`,structure:'left',vertexCount:positions.length/3,faces});
  const frame = process.env.CORTICAL_FRAME ?? (process.env.CORTICAL_MESH ? 'templateflow-input-RAS' : 'fsaverage5-RAS');
  const metric=new SurfaceMetric(domain,{positions,frame,units:'mm'});
  const report={frame,level:Number(level),vertices:domain.vertexCount,faces:domain.faceCount,fwhmMm:Number(process.argv.find(x=>x.startsWith('--fwhm=')).slice(7)),inputSha256:createHash('sha256').update(input).digest('hex'),bundleSha256:createHash('sha256').update(await readFile(new URL('../dist/surfview.es.js',import.meta.url))).digest('hex'),budgetBytes:512*1024*1024};
  try {
    const t=performance.now(),plan=buildSurfaceSmoothingPlan(metric,{fwhmMm:report.fwhmMm,budgetBytes:report.budgetBytes});report.buildMs=performance.now()-t;report.retainedBytes=plan.byteLength;
    const frames=Array.from({length:16},(_,f)=>Float64Array.from({length:domain.vertexCount},(_,v)=>Math.sin(positions[v*3]/20+f/4)));
    const prepared=plan.prepare({},report.budgetBytes);const timings=(fn)=>{fn();const ts=[];for(let i=0;i<7;i++){const t=performance.now();fn();ts.push(performance.now()-t);}ts.sort((a,b)=>a-b);return {p50:ts[3],p95:ts[6],samples:7,warmup:1,samplesMs:ts};};
    report.ordinary16Ms=timings(()=>frames.map(f=>plan.apply(f)));report.prepared16Ms=timings(()=>prepared.applyBatch(frames));
    const result=prepared.applyBatch(frames);let max=0;for(let f=0;f<frames.length;f++){const reference=plan.apply(frames[f]);for(let v=0;v<domain.vertexCount;v++)max=Math.max(max,Math.abs(result[f].values[v]-reference.values[v]));}report.maxBatchDifference=max;
  } catch(error){report.error={code:error.code,message:error.message};}
  report.isolatedProcessMaxRssBytes=process.resourceUsage().maxRSS*1024;
  await writeFile(output,JSON.stringify(report,null,2)+'\n');
}
