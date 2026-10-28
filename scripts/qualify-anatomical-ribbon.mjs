import { readFile,writeFile,mkdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { JSDOM } from 'jsdom';
import { SurfaceDomain,SurfaceMetric,buildRibbonIntegrationPlan,parseGIfTISurface,parseGIfTIScalars } from '../dist/surfview.es.js';
const wb=process.env.WB_COMMAND,base=process.env.ANATOMICAL_SURFACES??'/tmp/surfview-anatomical',out=process.argv[2]??'/tmp/surfview-anatomical-ribbon';if(!wb)throw new Error('Set WB_COMMAND');await mkdir(out,{recursive:true});
process.on('uncaughtException',e=>{console.error(e.message);process.exit(1);});
const parser=new JSDOM().window.DOMParser,load=async name=>{const bytes=await readFile(`${base}/${name}`);return {sha256:createHash('sha256').update(bytes).digest('hex'),...parseGIfTISurface(bytes.toString(),parser)};};
const white=await load('fsaverage10k-white.surf.gii'),pial=await load('fsaverage10k-pial.surf.gii');
if(white.faces.length!==pial.faces.length||white.faces.some((v,i)=>v!==pial.faces[i]))throw new Error('Paired surface topology differs');
const da=(intent,type,dims,values)=>`<DataArray Intent="${intent}" DataType="${type}" ArrayIndexingOrder="RowMajorOrder" Dimensionality="${dims.length}" ${dims.map((d,i)=>`Dim${i}="${d}"`).join(' ')} Encoding="ASCII" Endian="LittleEndian" ExternalFileName="" ExternalFileOffset="0"><MetaData/><Data>${values.join(' ')}</Data></DataArray>`;
const surface=(positions,faces)=>`<?xml version="1.0"?><GIFTI Version="1.0" NumberOfDataArrays="2"><MetaData/><LabelTable/>${da('NIFTI_INTENT_POINTSET','NIFTI_TYPE_FLOAT32',[positions.length/3,3],positions)}${da('NIFTI_INTENT_TRIANGLE','NIFTI_TYPE_INT32',[faces.length/3,3],faces)}</GIFTI>`;
function nifti(data,dims,origin){const bytes=Buffer.alloc(352+data.length*4);bytes.writeInt32LE(348,0);[3,...dims,1,1,1,1].forEach((v,i)=>bytes.writeInt16LE(v,40+i*2));bytes.writeInt16LE(16,70);bytes.writeInt16LE(32,72);[1,1,1,1,0,0,0,0].forEach((v,i)=>bytes.writeFloatLE(v,76+i*4));bytes.writeFloatLE(352,108);bytes.writeFloatLE(1,112);bytes[123]=2;bytes.writeInt16LE(1,254);for(let a=0;a<3;a++)[+(a===0),+(a===1),+(a===2),origin[a]].forEach((v,j)=>bytes.writeFloatLE(v,280+a*16+j*4));bytes.write('n+1\0',344);for(let i=0;i<data.length;i++)bytes.writeFloatLE(data[i],352+i*4);return gzipSync(bytes);}
const report={source:'TemplateFlow fsaverage10k corresponding white/pial anatomy; complete incident-face patches retain each selected central column.',whiteSha256:white.sha256,pialSha256:pial.sha256,version:execFileSync(wb,['-version'],{encoding:'utf8'}),cases:[],note:'Exact tetrahedral column integration compared with Workbench thin-column subvoxel mapping. These estimators may differ on warped faces; differences are reported, not tolerance-admitted.'};
for(const vertex of [0,100,1000,5000]){
 const dir=`${out}/v${vertex}`;await mkdir(dir,{recursive:true}); const entry={vertex};
 try {
 const fs=[];for(let i=0;i<pial.faces.length;i+=3)if([pial.faces[i],pial.faces[i+1],pial.faces[i+2]].includes(vertex))fs.push([...pial.faces.slice(i,i+3)]);
 const ids=[vertex,...[...new Set(fs.flat())].filter(v=>v!==vertex).sort((a,b)=>a-b)],faces=fs.flatMap(tri=>tri.map(v=>ids.indexOf(v))),w=ids.flatMap(v=>[...white.vertices.slice(v*3,v*3+3)]),p=ids.flatMap(v=>[...pial.vertices.slice(v*3,v*3+3)]),mid=w.map((v,i)=>Math.fround((v+p[i])/2));
 for(const [name,positions]of[['white',w],['pial',p],['mid',mid]])await writeFile(`${dir}/${name}.surf.gii`,surface(positions,faces));
 const domain=new SurfaceDomain({id:`anatomical-patch-${vertex}`,structure:'left',vertexCount:ids.length,faces}),whiteMetric=new SurfaceMetric(domain,{positions:w,frame:'fsaverage-surface-RAS',units:'mm'}),pialMetric=new SurfaceMetric(domain,{positions:p,frame:'fsaverage-surface-RAS',units:'mm'});
 const origin=[0,1,2].map(a=>Math.floor(Math.min(...w.filter((_,i)=>i%3===a),...p.filter((_,i)=>i%3===a)))-4),dims=[0,1,2].map(a=>Math.ceil(Math.max(...w.filter((_,i)=>i%3===a),...p.filter((_,i)=>i%3===a)))-origin[a]+5),affine=[1,0,0,0,0,1,0,0,0,0,1,0,...origin,1],size=dims.reduce((a,b)=>a*b,1);
 const values=Float32Array.from({length:size},(_,i)=>Math.sin((i%dims[0])*.7)+.3*Math.cos(Math.floor(i/dims[0])%dims[1])),ones=new Float32Array(size).fill(7),targets=new Uint8Array(ids.length);targets[0]=1;
 Object.assign(entry,{patchVertices:ids.length,patchFaces:faces.length/3,dims,origin});
 const plan=buildRibbonIntegrationPlan({domain,whiteMetric,pialMetric,volumeGrid:{dims,voxelToWorld:affine,frame:'fsaverage-surface-RAS',units:'mm'}},{targets}),constant=plan.apply(ones),result=plan.apply(values);
 entry.exact={constant:constant.values[0],mean:result.values[0],volumeMm3:result.totalVolumeMm3[0],coverage:result.validCoverage[0]};
 const masked=values.slice();for(let i=0;i<masked.length;i++)if(i%7===0)masked[i]=NaN;const partial=plan.apply(masked,{minCoverage:0});entry.missing={value:partial.values[0],coverage:partial.validCoverage[0],strictValid:plan.apply(masked).valid[0]};
 if(Math.abs(constant.values[0]-7)>1e-10||Math.abs(result.validCoverage[0]-1)>1e-10)throw new Error('Full-support constant witness failed');
 await writeFile(`${dir}/constant.nii.gz`,nifti(ones,dims,origin));await writeFile(`${dir}/values.nii.gz`,nifti(values,dims,origin));
 entry.workbench=[];
 for(const subdiv of [2,4,8,16]){
  const dest=`${dir}/wb-${subdiv}.func.gii`,args=['-volume-to-surface-mapping',`${dir}/values.nii.gz`,`${dir}/mid.surf.gii`,dest,'-ribbon-constrained',`${dir}/white.surf.gii`,`${dir}/pial.surf.gii`,'-thin-columns','-voxel-subdiv',String(subdiv),...(subdiv===16?['-output-weights-text',`${dir}/wb-weights.txt`]:[])];
  execFileSync(wb,args,{timeout:120000,stdio:'pipe',env:{...process.env,OMP_NUM_THREADS:'1'}});execFileSync(wb,['-gifti-convert','ASCII',dest,dest+'.ascii.gii'],{stdio:'pipe'});const reference=parseGIfTIScalars(await readFile(dest+'.ascii.gii','utf8'),parser)[0];entry.workbench.push({subdiv,value:reference,absoluteDifference:Math.abs(reference-result.values[0]),command:args});
 }
 const constOut=`${dir}/constant.func.gii`;execFileSync(wb,['-volume-to-surface-mapping',`${dir}/constant.nii.gz`,`${dir}/mid.surf.gii`,constOut,'-ribbon-constrained',`${dir}/white.surf.gii`,`${dir}/pial.surf.gii`,'-thin-columns','-voxel-subdiv','8'],{timeout:120000,stdio:'pipe',env:{...process.env,OMP_NUM_THREADS:'1'}});execFileSync(wb,['-gifti-convert','ASCII',constOut,constOut+'.ascii.gii'],{stdio:'pipe'});entry.workbenchConstant=parseGIfTIScalars(await readFile(constOut+'.ascii.gii','utf8'),parser)[0];if(Math.abs(entry.workbenchConstant-7)>1e-6)throw new Error('External constant witness failed');
 const input={vertex,ids,faces,white:w,pial:p,dims,origin,values:[...values],expected:entry.exact};await writeFile(`${dir}/model.json`,JSON.stringify(input)+'\n');
 }catch(e){entry.rejected={code:e.code,message:e.message};}
 report.cases.push(entry);await writeFile(`${out}/receipt.json`,JSON.stringify(report,null,2)+'\n');console.log(vertex,entry.rejected??entry.exact);
}
