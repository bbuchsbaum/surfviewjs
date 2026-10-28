import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import os from 'node:os';
import { JSDOM } from 'jsdom';
import { parseGIfTISurface, SurfaceDomain, SurfaceMetric, smoothSurfaceBatch, buildSurfaceSmoothingPlan } from '../dist/surfview.es.js';
const input=process.argv[2],output=process.argv[3],width=Number(process.argv[4]??4);if(!input||!output)throw new Error('mesh.gii report.json FWHM');
const bytes=await readFile(input),g=parseGIfTISurface(bytes.toString(),new JSDOM().window.DOMParser),n=g.vertices.length/3;
const domain=new SurfaceDomain({id:'streamed-cortex',structure:'left',vertexCount:n,faces:g.faces}),metric=new SurfaceMetric(domain,{positions:g.vertices,frame:'template-input-RAS',units:'mm'});
const frames=[new Float64Array(n).fill(7),Float64Array.from({length:n},(_,v)=>Math.sin(g.vertices[v*3]/20)),Float64Array.from({length:n},(_,v)=>Math.cos(g.vertices[v*3+1]/20))];
const masks=frames.map((_,f)=>Uint8Array.from({length:n},(_,v)=>+(f===0||v%(17+f)!==0)));
const report={vertices:n,fwhmMm:width,frames:frames.length,budgetBytes:128*1024*1024,inputSha256:createHash('sha256').update(bytes).digest('hex'),bundleSha256:createHash('sha256').update(await readFile(new URL('../dist/surfview.es.js',import.meta.url))).digest('hex'),runtime:process.version,hardware:{cpu:os.cpus()[0]?.model,arch:os.arch()},note:'One cold run; row-streamed, shared-neighborhood 3-frame batch with changing validity. Process RSS includes parser/fixture/caller frames. No GPU or latency-percentile claim.'};
try{const t=performance.now(),results=smoothSurfaceBatch(metric,frames,{fwhmMm:width,budgetBytes:report.budgetBytes},{frameValidity:masks});report.elapsedMs=performance.now()-t;
let constantError=0;for(let v=0;v<n;v++)if(results[0].valid[v])constantError=Math.max(constantError,Math.abs(results[0].values[v]-7));report.constantError=constantError;report.validCounts=results.map(r=>r.valid.reduce((a,b)=>a+b,0));report.coverageRanges=results.map(r=>{let min=1,max=0;for(const x of r.coverage){min=Math.min(min,x);max=Math.max(max,x);}return {min,max};});
if(constantError>1e-12||report.validCounts.some(c=>c!==n))throw new Error('Constant or support witness failed');
if(width===2){const plan=buildSurfaceSmoothingPlan(metric,{fwhmMm:width,budgetBytes:512*1024*1024});let max=0;for(let f=0;f<frames.length;f++){const expected=plan.apply(frames[f],{validity:masks[f]});for(let v=0;v<n;v++)max=Math.max(max,Math.abs(expected.values[v]-results[f].values[v]));}report.maxRetainedDifference=max;}
}catch(e){report.error={code:e.code,message:e.message};process.exitCode=1;}
report.processMaxRssBytes=process.resourceUsage().maxRSS*1024;await writeFile(output,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
