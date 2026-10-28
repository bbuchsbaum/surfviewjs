"""Independent determinant and IID volume-sampling witness for the documented column model."""
import json,sys,hashlib
from pathlib import Path
import numpy as np
root=Path(sys.argv[1]);results=[]
for file in root.glob('v*/model.json'):
 d=json.loads(file.read_text());w=np.array(d['white']).reshape(-1,3);p=np.array(d['pial']).reshape(-1,3);tets=[]
 for face in np.array(d['faces']).reshape(-1,3):
  k=list(face).index(0);centers=[q[face].mean(axis=0) for q in [w,p]]
  for neighbor in [face[(k+1)%3],face[(k+2)%3]]:
   a,b,c=w[0],(w[0]+w[neighbor])/2,centers[0];A,B,C=p[0],(p[0]+p[neighbor])/2,centers[1]
   tets.extend([[a,b,c,C],[a,b,B,C],[a,A,B,C]])
 tets=np.array(tets);volumes=np.abs(np.linalg.det((tets[:,1:]-tets[:,:1]).transpose(0,2,1)))/6;volume=volumes.sum()
 expected=d['expected'];row={'vertex':d['vertex'],'volume':float(volume),'exactVolume':expected['volumeMm3'],'relativeVolumeError':float(abs(volume-expected['volumeMm3'])/volume),'samples':[]}
 values=np.array(d['values']);dims=np.array(d['dims']);origin=np.array(d['origin'])
 for seed in [20261027,1729,91]:
  rng=np.random.default_rng(seed);count=200000;chosen=rng.choice(len(tets),size=count,p=volumes/volume);weights=rng.exponential(size=(count,4));weights/=weights.sum(axis=1)[:,None];points=np.sum(tets[chosen]*weights[:,:,None],axis=1)
  cells=np.floor(points-origin+0.5).astype(int)
  if np.any(cells<0) or np.any(cells>=dims):raise RuntimeError('Witness sampled outside the declared full-support grid')
  index=cells[:,0]+dims[0]*(cells[:,1]+dims[1]*cells[:,2]);samples=values[index];mean=samples.mean();se=samples.std(ddof=1)/np.sqrt(count);delta=abs(mean-expected['mean'])
  row['samples'].append({'seed':seed,'count':count,'mean':float(mean),'standardError':float(se),'absoluteError':float(delta),'withinSixSE':bool(delta<=6*se+1e-8)})
 if row['relativeVolumeError']>1e-10 or not all(x['withinSixSE'] for x in row['samples']):raise RuntimeError('Independent column witness failed: '+str(row))
 results.append(row)
receipt={'method':'Independent NumPy determinant plus IID Dirichlet tetrahedron volume sampling, three fixed seeds; six-SE checks are Monte Carlo diagnostics, not formal universal coverage guarantees. Column decomposition follows the published geometric model; clipping/CSR implementation is not called.','scriptSha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),'results':results}
(root/'independent-receipt.json').write_text(json.dumps(receipt,indent=2)+'\n');print(json.dumps(receipt,indent=2))
