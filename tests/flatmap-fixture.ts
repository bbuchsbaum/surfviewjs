import * as THREE from 'three';
import { SurfaceDomain, SurfaceMetric, GeometryWorkerClient, ColorMap, triangleLocation } from '../src/index';
import { FlatMapChart, FlatMapFrame, FlatMapSampler, FlatMapController, CanvasFlatMapRenderer, WebGLFlatMapRenderer, FlatMapSurfaceBinding, buildSurfaceRelief, exportFlatMap } from '../src/index.flatmap';
import { GPUPicker } from '../src/utils/GPUPicker';
import { ViewerPickingController } from '../src/viewer/ViewerPickingController';

async function contracts() {
  const worker = new GeometryWorkerClient({ workerFactory: () => new Worker(new URL('../src/geometry/geometryWorker.ts', import.meta.url), { type: 'module' }) });
  const domain = new SurfaceDomain({ id: 'square', structure: 'left', vertexCount: 4, faces: [0, 1, 2, 0, 2, 3] });
  const chart = new FlatMapChart({ domain, coordinates: [-1,-1,1,-1,1,1,-1,1], faces: [0,1,2,0,2,3], anatomicalVertices: [0,1,2,3], anatomicalFaces: [0,1], units: 'mm' });
  const metric = (z: number) => new SurfaceMetric(domain, { frame: 'test', units: 'mm', positions: [-1,-1,z,1,-1,z,1,1,z,-1,1,z] });
  const white = metric(0), pial = metric(1);
  const presentation = { colorMap: new ColorMap(['#061c40','#1188cc','#f1e4c3','#a01122'], { range: [0,1], threshold: [0.4,0.6] }), opacity: .7 };
  const cpu = new CanvasFlatMapRenderer(presentation), gpu = new WebGLFlatMapRenderer(presentation);
  document.body.append(cpu.canvas,gpu.canvas);
  const grid = { bounds: chart.bounds, width: 32, height: 32 }, controller = new FlatMapController(chart, { worker, tileSize: 16 });
  const sampler = new FlatMapSampler({ kind: 'vertex-scalar', domain }), frame = new FlatMapFrame([0,1,1,0], new Uint8Array([1,1,0,1]));
  controller.setSource(sampler,frame,{missing:'renormalize',minCoverage:.25}); cpu.setGrid(grid); gpu.setGrid(grid);
  const local = sampler.prepare((await import('../src/flatmap/FlatMapRasterPlan')).buildFlatMapRaster(chart,grid,{x:0,y:0,width:32,height:32})).apply(frame,{missing:'renormalize',minCoverage:.25});
  let maxValueError = 0, maskDifferences = 0;
  await controller.render(grid,(tile,samples)=>{
    cpu.updateTile(tile,samples); gpu.updateTile(tile,samples);
    for(let y=0;y<tile.height;y++) for(let x=0;x<tile.width;x++) {
      const i=y*tile.width+x,j=(tile.y+y)*grid.width+tile.x+x;
      if(samples.status[i]!==local.status[j]) maskDifferences++;
      if(samples.valid[i]) maxValueError=Math.max(maxValueError,Math.abs(samples.values[i]!-local.values[j]!));
    }
  });
  const pixels = (canvas: HTMLCanvasElement) => { const c=document.createElement('canvas');c.width=canvas.width;c.height=canvas.height;const ctx=c.getContext('2d')!;ctx.drawImage(canvas,0,0);return ctx.getImageData(0,0,c.width,c.height).data; };
  const cp=pixels(cpu.canvas),gp=pixels(gpu.canvas);let colorError=0;
  cp.forEach((v,i)=>{colorError=Math.max(colorError,Math.abs(v-gp[i]!));});
  const plans = controller.diagnostics.planBuilds;
  presentation.colorMap.setThreshold([0,0]); cpu.setPresentation(presentation); gpu.setPresentation(presentation);
  const recolorNoBuild = controller.diagnostics.planBuilds === plans;
  const beforeRestore=pixels(gpu.canvas);
  await new Promise<void>(resolve=>{
    gpu.canvas.addEventListener('webglcontextrestored',()=>{requestAnimationFrame(()=>resolve());},{once:true});
    gpu.canvas.addEventListener('webglcontextlost',()=>{setTimeout(()=>gpu.renderer.forceContextRestore(),20);},{once:true});
    gpu.renderer.forceContextLoss();
  });
  gpu.render(); const afterRestore=pixels(gpu.canvas);const contextRestored=beforeRestore.every((v,i)=>v===afterRestore[i]);
  controller.setSource(sampler,new FlatMapFrame([1,1,1,1]));await controller.render(grid,()=>{});
  const frameReuse = controller.diagnostics.planBuilds === plans;
  const exportOptions = { width: 32, label: 'Before', provenance: { revision: 1 } };
  const exporting = exportFlatMap(controller, presentation, exportOptions);
  presentation.colorMap.setRange([-3, 3]);
  exportOptions.label = 'After'; exportOptions.provenance.revision = 2;
  await controller.render(grid, () => {}); // Export must not cancel this interactive job.
  const exported = JSON.parse(await (await exporting).metadata.text());
  const exportSnapshot = exported.label === 'Before' && exported.provenance.revision === 1 &&
    exported.presentation.range[0] === 0 && exported.presentation.range[1] === 1 && exported.missing.minCoverage === 1;
  presentation.colorMap.setRange([0, 1]);
  const abort = new AbortController();let commits=0; const start=performance.now();
  const cancelled = controller.render({...grid,width:2048,height:2048},()=>{commits++;},abort.signal).then(()=>false,e=>e.code==='cancelled');
  abort.abort();const cancellation=await cancelled,cancelMs=performance.now()-start;
  const relief=buildSurfaceRelief(chart,white,pial);
  const surface = new FlatMapSurfaceBinding(chart,pial,gpu.field,{relief});surface.setDeformation(1,2,false);
  const renderer=new THREE.WebGLRenderer({antialias:false});renderer.setSize(200,200);document.body.append(renderer.domElement);
  const scene=new THREE.Scene();scene.add(surface.mesh!); const camera=new THREE.PerspectiveCamera(40,1,.1,20);camera.position.set(0,0,6);camera.lookAt(0,0,0);camera.updateMatrixWorld();
  const ortho=new THREE.OrthographicCamera(-1,1,1,-1,.1,10);ortho.position.z=6;ortho.updateMatrixWorld();
  renderer.setSize(32,32);renderer.render(scene,ortho);const draped=pixels(renderer.domElement),reference=pixels(gpu.canvas);let drapeColorError=0;
  draped.forEach((v,i)=>{drapeColorError=Math.max(drapeColorError,Math.abs(v-reference[i]!));});
  const marker = new THREE.Mesh(new THREE.SphereGeometry(.05),new THREE.MeshBasicMaterial({color:0xffff00}));
  marker.frustumCulled=false;marker.position.set(5,5,5);surface.mesh!.add(marker); // Mixed material changes Three's active program.
  renderer.render(scene,ortho);gpu.render();renderer.render(scene,ortho);
  const repainted=pixels(renderer.domElement);let stableAfterAnnotation=true;
  repainted.forEach((v,i)=>{if(Math.abs(v-reference[i]!)>1)stableAfterAnnotation=false;});
  marker.geometry.dispose();marker.material.dispose();surface.mesh!.remove(marker);
  renderer.setSize(200,200);
  renderer.render(scene,camera); const picker=new GPUPicker(renderer);picker.addSurface('lh',surface.mesh!);
  const picking=new ViewerPickingController({ getCanvas:()=>renderer.domElement,getCamera:()=>camera,getSurfaces:()=>new Map([['lh',surface]]),getGPUPicker:()=>picker,setGPUPicker:()=>{} });
  const rect=renderer.domElement.getBoundingClientRect(),x=rect.left+113,y=rect.top+89;
  const cpuHit=picking.pickSurfaceLocation({x,y}), gpuHit=picker.pick(x,y,camera);
  const positionsAgree=!!cpuHit.point&&!!gpuHit.point&&cpuHit.point.distanceTo(gpuHit.point)<.04;
  renderer.localClippingEnabled=true;
  (surface.mesh!.material as THREE.ShaderMaterial).clippingPlanes=[new THREE.Plane(new THREE.Vector3(-1,0,0),-2)];
  const clippedGpu=picker.pick(x,y,camera).surfaceId===null, clippedCpu=picking.pickSurfaceLocation({x,y}).surfaceId===null;
  (surface.mesh!.material as THREE.ShaderMaterial).clippingPlanes=null;
  const anchor = triangleLocation(domain,0,[.2,.4,.4]);surface.setDeformation(1,4,true);
  const p=surface.display.position(0),anchorUnchanged=anchor.kind==='triangle'&&anchor.face===0&&p[2]===4;
  picker.dispose();surface.dispose();renderer.dispose();renderer.forceContextLoss();renderer.domElement.remove();
  controller.dispose();const settled=await worker.diagnostics();
  cpu.dispose();gpu.dispose();worker.dispose();cpu.canvas.remove();gpu.canvas.remove();
  return {maxValueError,maskDifferences,colorError,exportSnapshot,stableAfterAnnotation,drapeColorError,contextRestored,clippedGpu,clippedCpu,recolorNoBuild,frameReuse,cancellation,cancelMs,commits,positionsAgree,cpuFace:cpuHit.location?.kind==='triangle'?cpuHit.location.face:null,gpuFace:gpuHit.faceIndex,anchorUnchanged,settled};
}
Object.assign(window,{flatmapContracts:contracts});
