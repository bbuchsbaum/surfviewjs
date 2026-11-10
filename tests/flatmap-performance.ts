import { SurfaceDomain, SurfaceMetric, GeometryWorkerClient, ColorMap } from '../src/index';
import { buildSurfaceReliefInWorker, FlatMapChart, FlatMapFrame, FlatMapSampler, FlatMapController, FlatMapField, FlatMapSurfaceBinding, WebGLFlatMapRenderer, buildFlatMapRaster, rasterPoint } from '../src/index.flatmap';
import { loadMatchedFlatMap } from '../demo/kit/flatmap-data';

const elapsed = (start: number) => performance.now()-start;
const quantile = (values: number[], p: number) => [...values].sort((a,b)=>a-b)[Math.floor((values.length-1)*p)]!;
function synthetic(side: number) {
  const n=side*side,xy=new Float64Array(n*2),positions=new Float64Array(n*3),faces=new Uint32Array((side-1)**2*6);let f=0;
  for(let y=0;y<side;y++)for(let x=0;x<side;x++){const v=y*side+x;xy[v*2]=x;xy[v*2+1]=y;positions[v*3]=x;positions[v*3+1]=y;if(x<side-1&&y<side-1){faces.set([v,v+1,v+side+1,v,v+side+1,v+side],f);f+=6;}}
  const domain=new SurfaceDomain({id:`grid-${side}`,structure:'left',vertexCount:n,faces});
  const chart=new FlatMapChart({domain,coordinates:xy,faces,anatomicalVertices:Uint32Array.from({length:n},(_,i)=>i),anatomicalFaces:Uint32Array.from({length:faces.length/3},(_,i)=>i),units:'mm'});
  return {chart,metric:new SurfaceMetric(domain,{positions,units:'mm',frame:'test'})};
}
async function benchmark() {
 const result: Record<string,unknown> = { userAgent:navigator.userAgent,dpr:devicePixelRatio,hardwareConcurrency:navigator.hardwareConcurrency,stamp:new Date().toISOString() };
 const shapes=[];
 for(const side of [100,180,405]){
   const start=performance.now(),{chart}=synthetic(side),buildMs=elapsed(start),times=[];
   for(let i=0;i<2000;i++){const x=((i*997)%1999)/1999*(side-1),y=((i*521)%1999)/1999*(side-1),t=performance.now();chart.locate(x,y);times.push(elapsed(t));}
   shapes.push({vertices:chart.vertexCount,faces:chart.faceCount,buildMs,chartBytes:chart.byteLength,lookupP95Ms:quantile(times,.95)});
 }
 result.synthetic=shapes;
 const loadStart=performance.now(),data=await loadMatchedFlatMap();result.realLoadAndValidationMs=elapsed(loadStart);
 const worker=new GeometryWorkerClient({workerFactory:()=>new Worker(new URL('../src/geometry/geometryWorker.ts',import.meta.url),{type:'module'})});
 try {
  const reliefStart=performance.now(),relief=await buildSurfaceReliefInWorker(worker, data.chart,data.white,data.pial,{mmPerUnit:data.calibration,regularizationFwhmMm:2.5});
  result.relief={preparationMs:elapsed(reliefStart),bytes:relief.byteLength,method:relief.method,regularizationMm:2.5};
  const reference = await (await fetch('/benchmarks/2026-10-28-flatmap/reference.json')).json() as {
    assetSha256: string;
    relief: Array<{chartVertex: number; heightMm: number}>;
    volume: Array<{chartFace: number; weights: [number,number,number]; valid: boolean; value: number | null; coverage: number; geometricCoverage: number}>;
  };
  if (reference.assetSha256 !== data.manifest.sha256) throw new Error('Reference anatomy differs');
  const rawHeight = relief.copyRawHeightMm();
  let rawMax = 0, rawSum = 0, volumeMax = 0, maskDifferences = 0, coverageError = 0;
  for (const expected of reference.relief) {
    const difference = Math.abs(rawHeight[expected.chartVertex]! - expected.heightMm);
    rawMax = Math.max(rawMax, difference); rawSum += difference * difference;
  }
  const referenceSampler = new FlatMapSampler({kind:'volume-scalar',white:data.white,pial:data.pial,
    dims:data.dims,voxelToWorld:data.voxelToWorld,frame:data.manifest.frame,depth:{interval:[.2,.8],samples:8}});
  for (const expected of reference.volume) {
    const read = referenceSampler.inspect(data.chart.location(expected.chartFace,expected.weights),data.volume,{missing:'renormalize',minCoverage:.5});
    if ((read.status === 'valid') !== expected.valid) maskDifferences++;
    if (expected.valid) volumeMax = Math.max(volumeMax,Math.abs(read.value - expected.value!));
    coverageError = Math.max(coverageError,Math.abs(read.coverage - expected.coverage),Math.abs(read.geometricCoverage - expected.geometricCoverage));
  }
  result.independentReference = {rawSamples:reference.relief.length,rawMaxErrorMm:rawMax,rawRmsErrorMm:Math.sqrt(rawSum/reference.relief.length),
    volumeSamples:reference.volume.length,volumeMaxError:volumeMax,maskDifferences,coverageError};
  if (rawMax > 1e-10 || volumeMax > 1e-10 || maskDifferences || coverageError > 1e-12) throw new Error('Independent reference failed');
  const displayStart = performance.now();
  const presentation={colorMap:ColorMap.fromPreset('coolwarm',{range:[-1,1]})},field=new FlatMapField(presentation),surface=new FlatMapSurfaceBinding(data.chart,data.pial,field,{relief});
  const gpu=new WebGLFlatMapRenderer(presentation,{field});document.body.append(gpu.canvas);gpu.setGrid({bounds:data.chart.bounds,width:512,height:512});
  const gl=gpu.renderer.getContext(),debug=gl.getExtension('WEBGL_debug_renderer_info');result.gpu=debug?gl.getParameter(debug.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER);
  // Separate initial validation, shader compilation and first upload from warm input.
  for (let i=0;i<3;i++) {
    surface.setDeformation(1,2,true);gpu.render();
    await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);
  }
  result.displaySetupAndWarmupMs = elapsed(displayStart);
  const deform=[],lookup=[],palette=[],frameLatencies=[],longTasks: number[]=[];
  const warmStart = performance.now();
  const observer = new PerformanceObserver(list => longTasks.push(...list.getEntries().filter(entry=>entry.startTime>=warmStart).map(entry => entry.duration)));
  observer.observe({entryTypes:['longtask']});
  for(let i=0;i<60;i++){
    const frameStart = performance.now();
    let t=performance.now();surface.setDeformation(1,i/20,true);deform.push(elapsed(t));
    t=performance.now();presentation.colorMap.setThreshold([-i/100,i/100]);gpu.setPresentation(presentation);palette.push(elapsed(t));
    for(let j=0;j<40;j++){const [x,y]=rasterPoint({bounds:data.chart.bounds,width:512,height:512},(i*17+j*31)%512,(i*37+j*13)%512);t=performance.now();data.chart.locate(x,y);lookup.push(elapsed(t));}
    await new Promise(requestAnimationFrame);
    await new Promise(requestAnimationFrame);
    frameLatencies.push(elapsed(frameStart));
  }
  longTasks.push(...observer.takeRecords().filter(entry=>entry.startTime>=warmStart).map(entry=>entry.duration));observer.disconnect();
  result.interaction={deformationCpuP95Ms:quantile(deform,.95),paletteSubmitP95Ms:quantile(palette,.95),lookupP95Ms:quantile(lookup,.95),
    twoAnimationFramesP95Ms:quantile(frameLatencies,.95),mainThreadTasksOver50Ms:longTasks.length,maxLongTaskMs:Math.max(0,...longTasks),
    note:'CPU deformation commit and 2D WebGL submission, then two animation callbacks; no 3D draw, GPU fence or input-to-photon measurement'};
  surface.dispose();gpu.dispose();field.dispose();gpu.canvas.remove();
  const rows=[];
  const nextFrame=new FlatMapFrame(Float64Array.from(data.volume.copyValues(),v=>v+.1),data.volume.copyValidity());
  for(const width of [512,1024,2048]) for(const samples of [1,8,32]) {
    const controller=new FlatMapController(data.chart,{worker,tileSize:64,budgetBytes:64*1048576});
    const sampler=new FlatMapSampler({kind:'volume-scalar',white:data.white,pial:data.pial,dims:data.dims,voxelToWorld:data.voxelToWorld,frame:data.manifest.frame,depth:{interval:[.2,.8],samples}});
    controller.setSource(sampler,data.volume,{missing:'renormalize',minCoverage:.5});
    const grid={bounds:data.chart.bounds,width,height:width};let supported=0;
    let start=performance.now();await controller.render(grid,(_,values)=>{for(const valid of values.valid)supported+=valid;});const coldMs=elapsed(start),cold=controller.diagnostics;
    start=performance.now();await controller.render(grid,()=>{});const repeatMs=elapsed(start);
    controller.setSource(sampler,nextFrame,{missing:'renormalize',minCoverage:.5});start=performance.now();await controller.render(grid,()=>{});const frameMs=elapsed(start),warm=controller.diagnostics,resources=await worker.diagnostics();
    const row={width,height:width,depthSamples:samples,coldMs,repeatMs,frameMs,completeFramesPerSecond:1000/frameMs,supportedPixels:supported,retainedCacheBytes:warm.retainedBytes,workerRetainedBytes:resources.retainedBytes,coldPlans:cold.planBuilds,totalPlans:warm.planBuilds,planCacheBudget:48*1048576,tilePreparationBytes:64*64*(56+samples*(8*12+1)+1)};
    rows.push(row);console.log('MATRIX',JSON.stringify(row));controller.dispose();
    const settled=await worker.diagnostics();if(settled.retainedBytes!==0)throw new Error(`Resource leak after matrix row: ${settled.retainedBytes}`);
  }
  result.matrix=rows;
  // Same 64x64 real-chart window: direct exact-location enumeration vs prepared stencils.
  const sampler=new FlatMapSampler({kind:'volume-scalar',white:data.white,pial:data.pial,dims:data.dims,voxelToWorld:data.voxelToWorld,frame:data.manifest.frame,depth:{interval:[.2,.8],samples:8}});
  const grid={bounds:data.chart.bounds,width:512,height:512};let start=performance.now();const raster=buildFlatMapRaster(data.chart,grid,{x:224,y:224,width:64,height:64});const rasterMs=elapsed(start);
  start=performance.now();const plan=sampler.prepare(raster);const prepareMs=elapsed(start);start=performance.now();const prepared=plan.apply(data.volume,{missing:'renormalize',minCoverage:.5});const applyMs=elapsed(start);let error=0,masks=0;
  start=performance.now();for(let i=0;i<raster.faces.length;i++)if(raster.faces[i]!>=0){const w=raster.weights.subarray(i*3,i*3+3),location=data.chart.location(raster.faces[i]!,[w[0]!,w[1]!,w[2]!]);const read=sampler.inspect(location,data.volume,{missing:'renormalize',minCoverage:.5});if((read.status==='valid')!==!!prepared.valid[i])masks++;if(prepared.valid[i])error=Math.max(error,Math.abs(prepared.values[i]!-read.value));}
  result.directVsPrepared={pixels:4096,depthSamples:8,rasterMs,prepareMs,applyMs,directMs:elapsed(start),maxValueError:error,maskDifferences:masks,planBytes:plan.byteLength};
  const cancellationController = new FlatMapController(data.chart,{worker,tileSize:128,budgetBytes:128*1048576});
  const cancellationSampler = new FlatMapSampler({kind:'volume-scalar',white:data.white,pial:data.pial,dims:data.dims,
    voxelToWorld:data.voxelToWorld,frame:data.manifest.frame,depth:{interval:[.2,.8],samples:32}});
  cancellationController.setSource(cancellationSampler,data.volume);
  await cancellationController.render({bounds:data.chart.bounds,width:8,height:8},()=>{});
  let cancelled = false, staleCommits = 0;
  const abort = new AbortController();
  const pending = cancellationController.render({bounds:data.chart.bounds,width:2048,height:2048},()=>{if(cancelled)staleCommits++;},abort.signal)
    .then(()=>false,error=>error.code==='cancelled');
  await new Promise(resolve=>setTimeout(resolve,5));
  const cancelStart = performance.now();cancelled = true;abort.abort();
  const rejected = await pending;
  const acknowledged = await worker.diagnostics();
  result.cancellation = {rejected,staleCommits,acknowledgedMs:elapsed(cancelStart),pendingJobs:acknowledged.pendingJobs,
    workload:'Warm source registration; 2048-square raster, 128-square tiles, 32 depths; abort requested after 5 ms'};
  if (!rejected || staleCommits || acknowledged.pendingJobs) throw new Error('Cancellation contract failed');
  cancellationController.dispose();
  result.disposed=await worker.diagnostics();
 } finally {worker.dispose();}
 return result;
}
Object.assign(window,{flatmapBenchmark:benchmark});
