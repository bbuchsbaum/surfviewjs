import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { JSDOM } from 'jsdom';
import { THREE, SurfaceDomain, SurfaceMetric, buildSurfaceResamplingPlan, parseGIfTIScalars } from '../dist/surfview.es.js';
const wb = process.env.WB_COMMAND;
if (!wb) throw new Error('Set WB_COMMAND to a versioned external Workbench executable');
const dir = process.argv[2] ?? '/tmp/surfview-workbench-parity'; await mkdir(dir,{recursive:true});
const run=(args)=>execFileSync(wb,args,{encoding:'utf8',timeout:60000});
const da=(intent,type,dim,data)=>`<DataArray Intent="${intent}" DataType="${type}" ArrayIndexingOrder="RowMajorOrder" Dimensionality="${dim.length}" ${dim.map((d,i)=>`Dim${i}="${d}"`).join(' ')} Encoding="ASCII" Endian="LittleEndian" ExternalFileName="" ExternalFileOffset="0"><MetaData/><Data>${data.join(' ')}</Data></DataArray>`;
const gifti=(arrays)=>`<?xml version="1.0"?><GIFTI Version="1.0" NumberOfDataArrays="${arrays.length}"><MetaData/><LabelTable/>${arrays.join('')}</GIFTI>`;
function mesh(detail,angle){const g=new THREE.OctahedronGeometry(100,detail),p=g.getAttribute('position'),positions=[],faces=[],ids=new Map();for(let v=0;v<p.count;v++){const x=p.getX(v),y=p.getY(v),z=p.getZ(v),q=[x*Math.cos(angle)-y*Math.sin(angle),x*Math.sin(angle)+y*Math.cos(angle),z].map(Math.fround),key=q.join(':');if(!ids.has(key)){ids.set(key,positions.length/3);positions.push(...q);}faces.push(ids.get(key));}g.dispose();const d=new SurfaceDomain({id:`oct-${detail}-${angle}`,structure:'left',vertexCount:positions.length/3,faces});return new SurfaceMetric(d,{positions,frame:'registered',units:'mm'});}
const source=mesh(1,0),target=mesh(2,0.13);
for(const [name,m] of [['source',source],['target',target]])await writeFile(`${dir}/${name}.surf.gii`,gifti([da('NIFTI_INTENT_POINTSET','NIFTI_TYPE_FLOAT32',[m.domain.vertexCount,3],[...m.copyPositions()]),da('NIFTI_INTENT_TRIANGLE','NIFTI_TYPE_INT32',[m.domain.faceCount,3],[...m.domain.copyFaces()])]));
const values=Float64Array.from({length:source.domain.vertexCount},(_,v)=>Math.sin(v*1.7)*0.8+0.2*Math.cos(v*.4));
await writeFile(`${dir}/values.func.gii`,gifti([da('NIFTI_INTENT_SHAPE','NIFTI_TYPE_FLOAT32',[values.length],[...values])]));
const cases=[];
for(const masked of [false,true]) for(const [method,oracle] of [['barycentric-closest','BARYCENTRIC'],['adaptive-barycentric-area','ADAP_BARY_AREA']]){
 const roi=Uint8Array.from({length:source.domain.vertexCount},(_,v)=>+(v%4!==0));
 if(masked) await writeFile(`${dir}/roi.func.gii`,gifti([da('NIFTI_INTENT_SHAPE','NIFTI_TYPE_FLOAT32',[roi.length],[...roi])]));
 const tag=oracle+(masked?'-masked':'');
 const args=['-metric-resample',`${dir}/values.func.gii`,`${dir}/source.surf.gii`,`${dir}/target.surf.gii`,oracle,`${dir}/${tag}.func.gii`,...(oracle==='ADAP_BARY_AREA'?['-area-surfs',`${dir}/source.surf.gii`,`${dir}/target.surf.gii`]:[])];
 if(masked) args.push('-current-roi',`${dir}/roi.func.gii`); args.push('-valid-roi-out',`${dir}/${tag}.roi.gii`);
 run(args); run(['-gifti-convert','ASCII',`${dir}/${tag}.func.gii`,`${dir}/${tag}.ascii.gii`]);
 const expected=parseGIfTIScalars(await readFile(`${dir}/${tag}.ascii.gii`,'utf8'),new JSDOM().window.DOMParser);
 run(['-gifti-convert','ASCII',`${dir}/${tag}.roi.gii`,`${dir}/${tag}.roi.ascii.gii`]);
 const support=parseGIfTIScalars(await readFile(`${dir}/${tag}.roi.ascii.gii`,'utf8'),new JSDOM().window.DOMParser);
 const plan=buildSurfaceResamplingPlan({source,target,registration:{id:'analytic-octahedra',frame:'registered',center:[0,0,0],radiusMm:100}},{method,sourceAreaMetric:source,targetAreaMetric:target,...(masked?{sourceROI:roi}:{})});
 const got=plan.apply(values,{missing:'renormalize'}),errors=Array.from(got.values,(v,i)=>support[i]?Math.abs(v-expected[i]):0);const max=Math.max(...errors),rms=Math.sqrt(errors.reduce((s,x)=>s+x*x,0)/errors.length);
 const maskMatches=Array.from(got.valid).every((v,i)=>Boolean(v)===Boolean(support[i]));
 cases.push({method,oracle,masked,maskMatches,command:args,maxAbsoluteError:max,rms,worstVertex:errors.indexOf(max),supportedRows:[...got.valid].reduce((a,b)=>a+b,0),passed:max<=5e-5&&rms<=1e-5&&maskMatches,expected:[...expected],actual:[...got.values]});
}
const receipt={version:run(['-version']),fixture:'Rotated analytic octahedral spheres; nonconstant full map; adaptive area metrics are the same synthetic spheres. Not population/cortical parity.',sourceVertices:source.domain.vertexCount,targetVertices:target.domain.vertexCount,bundleSha256:createHash('sha256').update(await readFile(new URL('../dist/surfview.es.js',import.meta.url))).digest('hex'),gates:{maxAbsoluteError:5e-5,rms:1e-5},cases};
await writeFile(`${dir}/receipt.json`,JSON.stringify(receipt,null,2)+'\n');console.log(JSON.stringify(cases.map(({method,maxAbsoluteError,rms,passed})=>({method,maxAbsoluteError,rms,passed})),null,2));
