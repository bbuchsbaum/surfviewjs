import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { JSDOM } from 'jsdom';
import { SurfaceDomain, SurfaceMetric, buildSurfaceResamplingPlan, parseGIfTISurface, parseGIfTIScalars } from '../dist/surfview.es.js';
const wb=process.env.WB_COMMAND;if(!wb)throw new Error('Set WB_COMMAND');
const inputs=process.env.HCP_FIXTURES ?? '/tmp/surfview-hcp-fixtures',output=process.argv[2] ?? '/tmp/surfview-template-parity';
await mkdir(output,{recursive:true});
process.on('uncaughtException', error => { console.error(JSON.stringify({code:error.code,message:error.message,stack:error.stack?.split('\n').filter(line=>line.trim().startsWith('at ')).slice(0,5)},null,2)); process.exit(1); });
const route=process.argv[3];
const names={'10k':'fsaverage5_std_sphere.L.10k_fsavg_L.surf.gii','32k':'fs_LR-deformed_to-fsaverage.L.sphere.32k_fs_LR.surf.gii','164k':'fsaverage_std_sphere.L.164k_fsavg_L.surf.gii'};
const hash=b=>createHash('sha256').update(b).digest('hex');
let activeChild;
const stopChild=()=>{if(activeChild?.pid){try{process.kill(-activeChild.pid,'SIGTERM');}catch{activeChild.kill('SIGTERM');}}};
process.once('SIGINT',()=>{stopChild();process.exit(130);});process.once('SIGTERM',()=>{stopChild();process.exit(143);});
async function runCase(args){
 return await new Promise(resolve=>{
  const child=spawn(process.execPath,args,{detached:true,stdio:['ignore','pipe','pipe']});activeChild=child;
  let stderr='',timedOut=false;
  child.stdout.on('data',()=>{});child.stderr.on('data',data=>{stderr=(stderr+data.toString()).slice(-20000);});
  const timer=setTimeout(()=>{timedOut=true;stopChild();},Number(process.env.PARITY_TIMEOUT_MS??600000));
  child.once('error',error=>{clearTimeout(timer);activeChild=undefined;resolve({error,status:null,stderr});});
  child.once('close',status=>{clearTimeout(timer);activeChild=undefined;resolve({status,stderr,error:timedOut?new Error('Owned parity case timed out and was terminated'):undefined});});
 });
}
if(!route){
 const results=[];
 for(const r of process.env.ANATOMICAL_SURFACES ? ['10k-164k','164k-10k'] : ['10k-32k','32k-10k','32k-164k','164k-32k']){
  const sub=`${output}/${r}`;await rm(`${sub}/receipt.json`,{force:true});const child=await runCase(['--expose-gc',import.meta.filename,sub,r]);
  try{results.push(JSON.parse(await readFile(`${sub}/receipt.json`,'utf8')));}catch{results.push({route:r,error:child.error?.message??child.stderr,status:child.status});}
  console.log(r,results.at(-1).cases?.map(c=>[c.method,c.masked,c.scalar.passed,c.labels.passed])??results.at(-1).error);
  await writeFile(`${output}/receipt.json`,JSON.stringify({version:execFileSync(wb,['-version'],{encoding:'utf8'}),sourceProvenance:JSON.parse(await readFile(`${inputs}/provenance.json`,'utf8')),fixtureNote:process.env.ANATOMICAL_SURFACES ? 'Full left fsaverage template spheres with independently fetched corresponding anatomical area metrics; generated scalars and labels. Canonical per-vertex face incidence validated. No population inference.' : 'Full left template spheres, generated index-varying scalars and labels. Adaptive test uses sphere-derived areas on both sides, not anatomical midthickness areas. No anatomical registration accuracy claim.',gates:{maxAbsoluteError:5e-5,rms:1e-5,support:'identical',labels:'identical except exact-weight ties'},bundleSha256:hash(await readFile(new URL('../dist/surfview.es.js',import.meta.url))),results},null,2)+'\n');
 }
 process.exit(results.every(r=>r.cases?.every(c=>c.scalar.passed&&c.labels.passed))?0:1);
}
const [s,t]=route.split('-'),parser=new JSDOM().window.DOMParser;
const load=async(name)=>{const path=`${inputs}/${names[name]}`,bytes=await readFile(path),g=parseGIfTISurface(bytes.toString(),parser),domain=new SurfaceDomain({id:names[name],structure:'left',vertexCount:g.vertices.length/3,faces:g.faces});return {path,sha256:hash(bytes),metric:new SurfaceMetric(domain,{positions:g.vertices,frame:'fsaverage-registration',units:'mm'})};};
const source=await load(s),target=await load(t),n=source.metric.domain.vertexCount;
if(process.env.ANATOMICAL_SURFACES){
 const canonical=faces=>{const keys=[];for(let i=0;i<faces.length;i+=3)keys.push([faces[i],faces[i+1],faces[i+2]].sort((a,b)=>a-b).join(':'));return keys.sort().join(';');};
 for(const [name,item] of [[s,source],[t,target]]){
  const path=`${process.env.ANATOMICAL_SURFACES}/fsaverage${name}-${process.env.AREA_GEOMETRY??'pial'}.surf.gii`,bytes=await readFile(path),anatomy=parseGIfTISurface(bytes.toString(),parser);
  if(anatomy.vertices.length/3!==item.metric.domain.vertexCount||canonical(anatomy.faces)!==canonical(item.metric.domain.copyFaces()))throw new Error('Anatomical topology does not match the named sphere domain');
  item.areaPath=path;item.areaSha256=hash(bytes);item.areaMetric=new SurfaceMetric(item.metric.domain,{positions:anatomy.vertices,frame:'fsaverage-surface-RAS',units:'mm'});
 }
}
const scalar=Float32Array.from({length:n},(_,v)=>Math.sin(v*1.7)*.8+Math.cos(v*.4)*.2),labels=Int32Array.from({length:n},(_,v)=>[101,202,303][v%3]),roi=Uint8Array.from({length:n},(_,v)=>+(v%13!==0));
const scalarArray=(intent,type,values)=>`<DataArray Intent="${intent}" DataType="${type}" ArrayIndexingOrder="RowMajorOrder" Dimensionality="1" Dim0="${values.length}" Encoding="ASCII" Endian="LittleEndian" ExternalFileName="" ExternalFileOffset="0"><MetaData/><Data>${[...values].join(' ')}</Data></DataArray>`;
const gii=(array,table='<LabelTable/>')=>`<?xml version="1.0"?><GIFTI Version="1.0" NumberOfDataArrays="1"><MetaData/>${table}${array}</GIFTI>`;
await writeFile(`${output}/scalar.func.gii`,gii(scalarArray('NIFTI_INTENT_SHAPE','NIFTI_TYPE_FLOAT32',scalar)));
await writeFile(`${output}/roi.func.gii`,gii(scalarArray('NIFTI_INTENT_SHAPE','NIFTI_TYPE_FLOAT32',roi)));
await writeFile(`${output}/labels.label.gii`,gii(scalarArray('NIFTI_INTENT_LABEL','NIFTI_TYPE_INT32',labels),'<LabelTable>'+[0,101,202,303].map(x=>`<Label Key="${x}" Red="0.5" Green="0.5" Blue="0.5" Alpha="1">Label${x}</Label>`).join('')+'</LabelTable>'));
const run=(args)=>execFileSync(wb,args,{encoding:'utf8',timeout:120000,stdio:['ignore','pipe','pipe']});
const readArray=async(file,cached=false)=>{const ascii=file+'.ascii.gii';if(!cached)run(['-gifti-convert','ASCII',file,ascii]);const xml=await readFile(ascii,'utf8');
 const document=new parser().parseFromString(xml,'application/xml'),array=document.querySelector('DataArray');
 if(array?.getAttribute('Intent')==='NIFTI_INTENT_LABEL'){
  const values=Float64Array.from(array.querySelector('Data').textContent.trim().split(/\s+/).map(Number));
  if(values.length!==Number(array.getAttribute('Dim0'))||values.some(x=>!Number.isSafeInteger(x)))throw new Error('Malformed external label fixture');
  return values;
 }
 return parseGIfTIScalars(xml,parser);};
const referenceRoot=process.env.WORKBENCH_REFERENCE_ROOT?`${process.env.WORKBENCH_REFERENCE_ROOT}/${route}`:undefined;
let referenceReceipt;
if(referenceRoot){
 referenceReceipt=JSON.parse(await readFile(`${referenceRoot}/receipt.json`,'utf8'));
 if(referenceReceipt.source.sha256!==source.sha256||referenceReceipt.target.sha256!==target.sha256||referenceReceipt.source.areaSha256!==source.areaSha256||referenceReceipt.target.areaSha256!==target.areaSha256)throw new Error('Cached oracle geometry/area identity mismatch');
 for(const name of ['scalar.func.gii','labels.label.gii','roi.func.gii'])if(hash(await readFile(`${referenceRoot}/${name}`))!==hash(await readFile(`${output}/${name}`)))throw new Error('Cached oracle input values/mask mismatch');
}
const cases=[];
for(const masked of [false,true])for(const [method,oracle]of[['barycentric-closest','BARYCENTRIC'],['adaptive-barycentric-area','ADAP_BARY_AREA']]){
 globalThis.gc?.();const begin=performance.now();
 const plan=buildSurfaceResamplingPlan({source:source.metric,target:target.metric,registration:{id:route,frame:'fsaverage-registration',center:[0,0,0],radiusMm:100,relativeTolerance:0.002}},{method,sourceAreaMetric:source.areaMetric??source.metric,targetAreaMetric:target.areaMetric??target.metric,...(masked?{sourceROI:roi}:{}),budgetBytes:512*1024*1024,...(process.env.PROJECTION_PROFILE?{projectionProfile:process.env.PROJECTION_PROFILE}:{}),...(process.env.SPHERE_NORMALIZATION==='radius'?{sphereNormalization:'radius'}:{})});
 const result={method,masked,referenceCache:referenceRoot,projectionProfile:process.env.PROJECTION_PROFILE??'float64-closest',sphereNormalization:process.env.SPHERE_NORMALIZATION??'none',buildMs:performance.now()-begin};
 for(const kind of ['scalar','labels']){
  const tag=`${method}-${masked}-${kind}`,out=`${output}/${tag}.${kind==='scalar'?'func':'label'}.gii`,support=`${output}/${tag}.roi.func.gii`;
  const args=[kind==='scalar'?'-metric-resample':'-label-resample',`${output}/${kind==='scalar'?'scalar.func.gii':'labels.label.gii'}`,source.path,target.path,oracle,out,...(oracle==='ADAP_BARY_AREA'?['-area-surfs',source.areaPath??source.path,target.areaPath??target.path]:[]),...(masked?['-current-roi',`${output}/roi.func.gii`]:[]),'-valid-roi-out',support];
  if(!referenceRoot)run(args);const expected=await readArray(referenceRoot?`${referenceRoot}/${out.split('/').at(-1)}`:out,!!referenceRoot),expectedSupport=await readArray(referenceRoot?`${referenceRoot}/${support.split('/').at(-1)}`:support,!!referenceRoot),got=kind==='scalar'?plan.apply(scalar,{missing:'renormalize'}):plan.applyLabels(labels,{missing:'renormalize'});
  let max=0,sum=0,count=0,maskMismatches=0,nonfinite=0;const mismatches=[],supportMismatchVertexIds=[],nonfiniteVertexIds=[];
  for(let v=0;v<expected.length;v++){
   if(Boolean(expectedSupport[v])!==Boolean(got.valid[v])){maskMismatches++;supportMismatchVertexIds.push(v);}
   if(!expectedSupport[v])continue;
   if(!got.valid[v]||!Number.isFinite(got.values[v])){nonfinite++;nonfiniteVertexIds.push(v);continue;}
   const e=Math.abs(got.values[v]-expected[v]);max=Math.max(max,e);sum+=e*e;count++;if(e> (kind==='scalar'?5e-5:0))mismatches.push(v);
  }
  let ties=0;
  if(kind==='labels'&&mismatches.length){const w=plan.copyWeights();for(const v of mismatches){const votes=new Map();for(let j=w.offsets[v];j<w.offsets[v+1];j++)votes.set(labels[w.indices[j]],(votes.get(labels[w.indices[j]])??0)+w.weights[j]);const totals=[...votes.values()].sort((a,b)=>b-a);if(totals.length>1&&totals[0]===totals[1])ties++;}}
  const rms=Math.sqrt(sum/Math.max(1,count));result[kind]={maxAbsoluteError:max,rms,count,maskMismatches,supportMismatchVertexIds,nonfinite,nonfiniteVertexIds,mismatchCount:mismatches.length,exactTies:ties,worstVertexIds:mismatches.slice(0,30),passed:!maskMismatches&&!nonfinite&&(kind==='scalar'?max<=5e-5&&rms<=1e-5:mismatches.length===ties),command:args};
 }
 cases.push(result);
}
await writeFile(`${output}/receipt.json`,JSON.stringify({route,source:{file:source.path,sha256:source.sha256,vertices:n,areaFile:source.areaPath,areaSha256:source.areaSha256},target:{file:target.path,sha256:target.sha256,vertices:target.metric.domain.vertexCount,areaFile:target.areaPath,areaSha256:target.areaSha256},cases,isolatedProcessMaxRssBytes:process.resourceUsage().maxRSS*1024},null,2)+'\n');
