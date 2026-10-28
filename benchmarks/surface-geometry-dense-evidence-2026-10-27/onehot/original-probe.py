import sys, json, hashlib, subprocess
from pathlib import Path
import numpy as np

sys.path.insert(0, '/Users/bbuchsbaum/code/neurotransform/tools')
from generate_barycentric_oracle import read_gifti, write_gifti, sha

out = Path(__file__).parent
wb = '/tmp/surfview-workbench-mount/ConnectomeWorkbench.app/Contents/usr/bin/wb_command'
base = Path('/tmp/surfview-hcp-fixtures')
source = base / 'fs_LR-deformed_to-fsaverage.L.sphere.32k_fs_LR.surf.gii'
target = base / 'fsaverage_std_sphere.L.164k_fsavg_L.surf.gii'
vertex = 119351
vertices, faces = read_gifti(source)
queries, _ = read_gifti(target)

def normalize(p, mode):
    if mode == 'raw': return p.astype(float)
    if mode == 'double':
        x = p.astype(float)
        return x * (100 / np.linalg.norm(x, axis=1))[:, None]
    x = p.astype(np.float32)
    length = np.sqrt((x[:, 0]*x[:, 0] + x[:, 1]*x[:, 1]) + x[:, 2]*x[:, 2])
    return (x * (np.float32(100) / length)[:, None]).astype(float)

def independent(p, q):
    tri = p[faces]
    upper = np.min(np.sum((p-q)**2, axis=1))
    lower = np.sum(np.maximum(0, np.maximum(tri.min(axis=1)-q, q-tri.max(axis=1)))**2, axis=1)
    candidates = np.flatnonzero(lower <= upper)
    results = []
    for fi in candidates:
        t = tri[fi]
        yz = np.linalg.lstsq((t[1:]-t[0]).T, q-t[0], rcond=None)[0]
        bary = np.r_[1-yz.sum(), yz]
        trials = [('face', bary)] if min(bary) >= 0 else []
        for a,b in [(0,1),(1,2),(2,0)]:
            e = t[b]-t[a]
            u = np.clip(np.dot(e,q-t[a])/np.dot(e,e),0,1)
            w = np.zeros(3); w[a]=1-u; w[b]=u
            trials.append(('edge',w))
        d,kind,w = min(((float(np.sum((q-w@t)**2)),kind,w) for kind,w in trials), key=lambda item:item[0])
        results.append(dict(face=int(fi), nodes=faces[fi].tolist(), weights=w.tolist(), kind=kind, distanceSquared=d, unconstrainedWeights=bary.tolist()))
    return sorted(results, key=lambda x:(x['distanceSquared'],x['face']))

geometries = {}
nodes = set()
for mode in ['raw','double','float']:
    p = normalize(vertices,mode); q=normalize(queries[vertex:vertex+1],mode)[0]
    results=independent(p,q)
    geometries[mode] = dict(query=q.tolist(), candidates=results)
    for r in results: nodes.update(r['nodes'])
nodes=sorted(nodes)
maps=[]
for node in nodes:
    values=np.zeros(len(vertices),dtype=np.float32);values[node]=1
    maps.append(('NIFTI_INTENT_SHAPE',values))
complement=np.ones(len(vertices),dtype=np.float32);complement[nodes]=0
maps.extend([('NIFTI_INTENT_SHAPE',complement),('NIFTI_INTENT_SHAPE',np.ones(len(vertices),dtype=np.float32))])
write_gifti(out/'impulses.func.gii',maps)
args=[wb,'-metric-resample',str(out/'impulses.func.gii'),str(source),str(target),'BARYCENTRIC',str(out/'output.func.gii')]
run=subprocess.run(args,text=True,capture_output=True,timeout=120)
if run.returncode: raise RuntimeError(run.stderr)
columns=read_gifti(out/'output.func.gii')
weights={str(node):float(column[vertex]) for node,column in zip(nodes,columns) if column[vertex]!=0}
p=normalize(vertices,'float');q=normalize(queries[vertex:vertex+1],'float')[0]
best=geometries['float']['candidates'][0]
wb_nodes=[int(n) for n in weights]
edge_compare=None
if len(wb_nodes)==2:
    a,b=p[wb_nodes];e=b-a;u=np.clip(np.dot(q-a,e)/np.dot(e,e),0,1)
    dist=float(np.sum((q-a-u*e)**2))
    recovered_point=sum(float(w)*p[int(n)] for n,w in weights.items())
    edge_compare=dict(nodes=wb_nodes, exactEdgeWeights=[float(1-u),float(u)], edgeDistanceSquared=dist, faceDistanceSquared=best['distanceSquared'], edgeMinusFaceDistanceSquared=dist-best['distanceSquared'], recoveredPointDistanceSquared=float(np.sum((q-recovered_point)**2)))
values=np.array([np.sin(v*1.7)*.8+np.cos(v*.4)*.2 for v in range(len(vertices))],dtype=np.float32)
receipt=dict(targetVertex=vertex, method='BARYCENTRIC', fullSourceVertices=len(vertices), fullTargetVertices=len(queries), sourceSha256=sha(source),targetSha256=sha(target), scriptSha256=sha(__file__), inputSha256=sha(out/'impulses.func.gii'),outputSha256=sha(out/'output.func.gii'),workbenchVersion=subprocess.check_output([wb,'-version'],text=True), command=args,exitCode=run.returncode,stderr=run.stderr,probeNodes=nodes,workbenchWeights=weights,workbenchRowSum=sum(weights.values()),outsideProbeMass=float(columns[-2][vertex]),constantOutput=float(columns[-1][vertex]),reconstructedScalar=sum(w*float(values[int(n)]) for n,w in weights.items()),independentGeometry=geometries, floatGeometryEdgeComparison=edge_compare,qualification='Bounded single-target ordinary barycentric probe; no adaptive or anatomical qualification. Float normalization uses explicit float32 multiply/add/sqrt/divide; compiler contraction may differ.')
(out/'receipt.json').write_text(json.dumps(receipt,indent=2)+'\n')
print(json.dumps({k:receipt[k] for k in ['probeNodes','workbenchWeights','workbenchRowSum','outsideProbeMass','constantOutput','reconstructedScalar','floatGeometryEdgeComparison']},indent=2))
print(out/'receipt.json')
