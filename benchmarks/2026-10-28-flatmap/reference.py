"""Regenerate independent raw-height and affine-volume witnesses (Python + NumPy).

Only named, pinned pycortex functions are executed. The smoothing call is replaced
with identity to expose raw folding height; no finished-relief parity is implied.
"""
import ast
import gzip
import hashlib
import json
from pathlib import Path
from urllib.request import urlopen

import numpy as np

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
REVISION = '1e4c0790b66bcbcd836b5832650908f83327c399'
CACHE = Path('/tmp/surfview-pycortex-review')
CACHE.mkdir(exist_ok=True)


def sha(data):
    return hashlib.sha256(data).hexdigest()


namespace = {'np': np, '_regularise_log_height': lambda flat, faces, values, length: values}
sources = []
for filename, names in [('misc', {'face_area'}), ('bumpy', {'_lumped', 'folding_height'})]:
    url = f'https://raw.githubusercontent.com/gallantlab/pycortex/{REVISION}/cortex/polyutils/{filename}.py'
    path = CACHE / f'cortex_polyutils_{filename}.py'
    if not path.exists():
        path.write_bytes(urlopen(url).read())
    source = path.read_bytes()
    tree = ast.parse(source)
    functions = [node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name in names]
    assert {node.name for node in functions} == names
    exec(compile(ast.Module(body=functions, type_ignores=[]), url, 'exec'), namespace)
    sources.append({'url': url, 'sha256': sha(source), 'functions': sorted(names)})

data_root = ROOT / 'demo/data/flatmap'
manifest = json.loads((data_root / 'manifest.json').read_text())
compressed = (data_root / 's1-lh.bin.gz').read_bytes()
assert sha(compressed) == manifest['sha256']
raw = gzip.decompress(compressed)
assert sha(raw) == manifest['uncompressedSha256']


def array(name, dtype, width):
    entry = manifest['arrays'][name]
    return np.frombuffer(raw, dtype, entry['length'], entry['offset']).reshape(-1, width)


white = array('white', '<f4', 3).astype(float)
pial = array('pial', '<f4', 3).astype(float)
faces = array('faces', '<u4', 3)
chart_faces = array('chartFaces', '<u4', 3)
ids = array('anatomicalVertices', '<u4', 1).ravel()
active = np.unique(chart_faces)
height = namespace['folding_height'](white * 0, white, pial, faces, correlation_length=0)
selected = sorted(set(active[np.linspace(0, len(active) - 1, 128).astype(int)].tolist() +
                      [int(active[np.argmin(height[ids[active]])]), int(active[np.argmax(height[ids[active]])])]))
relief = [{'chartVertex': v, 'anatomicalVertex': int(ids[v]), 'heightMm': float(height[ids[v]])} for v in selected]

# The browser's real-anatomy volume has a known affine field and a missing slab.
# Evaluate its closed-form field only when independently enumerated corners are valid.
weights = np.array([.2, .3, .5])
depths = .2 + (np.arange(8) + .5) * (.6 / 8)
volume = []
for chart_face in np.linspace(0, len(chart_faces) - 1, 128).astype(int):
    vertices = ids[chart_faces[chart_face]]
    w, p = weights @ white[vertices], weights @ pial[vertices]
    samples, geometric = [], 0
    for depth in depths:
        point = w * (1 - depth) + p * depth
        voxel = (point - [-100, -120, -80]) / 3
        lower = np.floor(voxel).astype(int)
        fraction = voxel - lower
        inside, valid = True, True
        for z in range(2):
            for y in range(2):
                for x in range(2):
                    offset = np.array([x, y, z])
                    weight = np.prod(np.where(offset, fraction, 1 - fraction))
                    if weight <= 0:
                        continue
                    corner = lower + offset
                    if np.any(corner < 0) or np.any(corner >= [64, 80, 64]):
                        inside, valid = False, False
                    world = corner * 3 + [-100, -120, -80]
                    if abs(world[1] + 35) < 6 and 20 < world[2] < 45:
                        valid = False
        geometric += int(inside)
        if valid:
            samples.append(float(point @ np.array([1, 2, 1]) / 200))
    coverage = len(samples) / 8
    volume.append({'chartFace': int(chart_face), 'weights': weights.tolist(), 'coverage': coverage,
                   'geometricCoverage': geometric / 8, 'valid': coverage >= .5,
                   'value': float(np.mean(samples)) if coverage >= .5 else None})

result = {'schema': 'surfview.flatmap-reference.v1', 'sourceRevision': REVISION, 'sources': sources,
          'assetSha256': manifest['sha256'], 'arithmetic': 'float64 from original float32 geometry',
          'scope': 'Pinned raw folding formula on complete anatomical topology; smoothing bypassed. '
                   'Volume witness uses independent analytic field and corner support, not pycortex rasterization.',
          'relief': relief, 'volume': volume}
(HERE / 'reference.json').write_text(json.dumps(result, indent=2) + '\n')
print(f'Wrote {len(relief)} raw-height and {len(volume)} affine-volume witnesses.')
