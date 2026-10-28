import { Worker } from 'node:worker_threads';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { JSDOM } from 'jsdom';
import { SurfaceDomain, SurfaceMetric, GeometryWorkerClient, parseGIfTISurface } from '../dist/surfview.es.js';
const input=process.argv[2],output=process.argv[3];if(!input||!output)throw new Error('Usage: node benchmark-worker-batches.mjs mesh.gii output.json');
const bytes=await readFile(input),g=parseGIfTISurface(bytes.toString(),new JSDOM().window.DOMParser),domain=new SurfaceDomain({id:'worker-benchmark',structure:'left',vertexCount:g.vertices.length/3,faces:g.faces}),metric=new SurfaceMetric(domain,{positions:g.vertices,frame:'input-RAS',units:'mm'});
const url=new URL('../dist/surfview.geometry.worker.js',import.meta.url).href;
const bootstrap=`import { parentPort } from 'node:worker_threads';globalThis.addEventListener=(_,fn)=>parentPort.on('message',data=>fn({data}));globalThis.postMessage=value=>parentPort.postMessage(value);await import(${JSON.stringify(url)});parentPort.postMessage({ready:true});`;
const native=new Worker(new URL('data:text/javascript,'+encodeURIComponent(bootstrap)));
await new Promise((resolve,reject)=>{native.once('message',resolve);native.once('error',reject);});
const listeners=new Map(),client=new GeometryWorkerClient({limits:{budgetBytes:512*1024*1024,planBudgetBytes:256*1024*1024},workerFactory:()=>({postMessage:m=>native.postMessage(m),terminate:()=>void native.terminate(),addEventListener:(type,fn)=>{const wrapper=type==='message'?data=>fn({data}):fn;listeners.set(fn,wrapper);native.on(type,wrapper);},removeEventListener:(type,fn)=>{native.off(type,listeners.get(fn));listeners.delete(fn);}})});
const report={vertices:domain.vertexCount,fwhmMm:2,inputSha256:createHash('sha256').update(bytes).digest('hex'),bundleSha256:createHash('sha256').update(await readFile(new URL('../dist/surfview.es.js',import.meta.url))).digest('hex'),note:'Node worker_threads with Web Worker transport adapter; round trips include client copies and structured cloning. Not browser GPU upload timing.',runtime:process.version};
try{
 const start=performance.now(),d=await client.registerDomain(domain),m=await client.registerMetric(d,metric),s=await client.buildSmoothing(m,{fwhmMm:2,budgetBytes:512*1024*1024}),p=await client.prepareSmoothing(s,{},512*1024*1024);report.registrationBuildPrepareMs=performance.now()-start;
 const frames=Array.from({length:16},(_,f)=>Float64Array.from({length:domain.vertexCount},(_,v)=>f?Math.sin(v*.01+f*.1):7));
 const ordinary=await client.apply(s,frames[1]),result=await client.applyBatch(p,frames.slice(0,2));
 let difference=0,constantError=0;for(let v=0;v<domain.vertexCount;v++){difference=Math.max(difference,Math.abs(ordinary.values[v]-result[1].values[v]));constantError=Math.max(constantError,Math.abs(result[0].values[v]-7));}
 if(difference>1e-12||constantError>1e-12)throw new Error('Worker numerical witness failed');report.maxOrdinaryDifference=difference;report.constantError=constantError;
 const times=[];for(let i=0;i<8;i++){const t=performance.now();await client.applyBatch(p,frames);if(i)times.push(performance.now()-t);}times.sort((a,b)=>a-b);report.batch16RoundTripMs={p50:times[3],p95:times[6],samplesMs:times,warmup:1};
 const controller=new AbortController(),job=client.applyBatch(p,frames,{signal:controller.signal});const observed=job.then(()=>({cancelled:false}),e=>({cancelled:e.code==='cancelled'}));await new Promise(resolve=>setTimeout(resolve,10));const abortAt=performance.now();controller.abort();report.cancellation=await observed;report.clientCancellationMs=performance.now()-abortAt;
 const t=performance.now();await client.release(p);report.workerReleaseAfterAbortMs=performance.now()-t;
 for(const h of [s,m,d])await client.release(h);
} catch(error){report.error={message:error.message,code:error.code};process.exitCode=1;} finally{client.dispose();await native.terminate();}
report.processMaxRssBytes=process.resourceUsage().maxRSS*1024;await writeFile(output,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
