#!/usr/bin/env python3
"""Reproduce the S1 left-hemisphere fixture from pinned pycortex source assets.

Requires Python 3 and NumPy. Original GIFTI files are cached outside the repo.
No vertex resampling, decimation, coordinate normalization or anatomical repair.
The derived chart explicitly excludes flipped and overlapping flat faces.
"""
import argparse
import base64
import gzip
import hashlib
import json
from pathlib import Path
import urllib.request
import xml.etree.ElementTree as ET
import zlib

import numpy as np

REVISION = '1e4c0790b66bcbcd836b5832650908f83327c399'
ROOT = Path(__file__).resolve().parents[1]
BASE = f'https://raw.githubusercontent.com/gallantlab/pycortex/{REVISION}/'


def sha(data):
    return hashlib.sha256(data).hexdigest()


def read_surface(path):
    arrays = {}
    for element in ET.parse(path).getroot().findall('DataArray'):
        dtype = '<f4' if 'FLOAT' in element.attrib['DataType'] else '<i4'
        data = np.frombuffer(zlib.decompress(base64.b64decode(element.findtext('Data'))), dtype=dtype).reshape(-1, 3)
        arrays['positions' if 'POINTSET' in element.attrib['Intent'] else 'faces'] = data
    return arrays['positions'], arrays['faces']


def overlapping_faces(points, faces):
    """Independent vectorized separating-axis oracle; touching edges are admitted."""
    triangles = points[faces].astype(np.float64)
    low, high = triangles.min(1), triangles.max(1)
    minimum, span = low.min(0), high.max(0) - low.min(0)
    side = 192
    lo = np.clip(((low - minimum) / span * side).astype(int), 0, side - 1)
    hi = np.clip(((high - minimum) / span * side).astype(int), 0, side - 1)
    bins = {}
    for face, ((x0, y0), (x1, y1)) in enumerate(zip(lo, hi)):
        for y in range(y0, y1 + 1):
            for x in range(x0, x1 + 1):
                bins.setdefault(y * side + x, []).append(face)
    bad = set()
    pending = []
    pairs_found = 0

    def check(pairs):
        if not pairs:
            return 0
        ids = np.asarray(pairs)
        a, b = triangles[ids[:, 0]], triangles[ids[:, 1]]
        alive = np.ones(len(ids), dtype=bool)
        for own in (a, b):
            for edge in range(3):
                origin = own[:, edge, :]
                direction = own[:, (edge + 1) % 3, :] - origin
                aa, bb = a - origin[:, None, :], b - origin[:, None, :]
                pa = direction[:, 0, None] * aa[:, :, 1] - direction[:, 1, None] * aa[:, :, 0]
                pb = direction[:, 0, None] * bb[:, :, 1] - direction[:, 1, None] * bb[:, :, 0]
                tolerance = np.maximum(np.abs(pa).max(1), np.abs(pb).max(1)) * 64 * np.finfo(float).eps
                alive &= np.minimum(pa.max(1), pb.max(1)) - np.maximum(pa.min(1), pb.min(1)) > tolerance
        bad.update(ids[alive].ravel().tolist())
        return int(alive.sum())

    for cell, candidates in bins.items():
        for i, a in enumerate(candidates):
            for b in candidates[i + 1:]:
                if cell != max(lo[a, 1], lo[b, 1]) * side + max(lo[a, 0], lo[b, 0]):
                    continue
                if np.any(low[a] >= high[b]) or np.any(low[b] >= high[a]):
                    continue
                pending.append((a, b))
                if len(pending) >= 32768:
                    pairs_found += check(pending)
                    pending.clear()
    pairs_found += check(pending)
    return np.array(sorted(bad), dtype=np.int64), pairs_found


def split_chart_fans(points, triangles):
    """Split disconnected incident-face fans; retain coordinates and anatomical IDs."""
    faces = triangles.copy()
    incident = [[] for _ in points]
    for face, vertices in enumerate(triangles):
        for vertex in vertices:
            incident[int(vertex)].append(face)
    correspondence = list(range(len(points)))
    splits = []
    for vertex, members in enumerate(incident):
        if len(members) < 2:
            continue
        parents = list(range(len(members)))
        def root(i):
            while parents[i] != i:
                parents[i] = parents[parents[i]]
                i = parents[i]
            return i
        edge_owner = {}
        for i, face in enumerate(members):
            for neighbor in triangles[face]:
                if neighbor == vertex:
                    continue
                if int(neighbor) in edge_owner:
                    parents[root(i)] = root(edge_owner[int(neighbor)])
                else:
                    edge_owner[int(neighbor)] = i
        groups = {}
        for i, face in enumerate(members):
            groups.setdefault(root(i), []).append(face)
        for group in list(groups.values())[1:]:
            copy = len(correspondence)
            correspondence.append(vertex)
            for face in group:
                faces[face, triangles[face] == vertex] = copy
            splits.append({'anatomicalVertex': vertex, 'chartVertex': copy, 'chartFaces': group})
    ids = np.asarray(correspondence, dtype='<u4')
    return points[ids], faces, ids, splits


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--cache', type=Path, default=Path('/tmp/surfview-pycortex-review/S1'))
    args = parser.parse_args()
    args.cache.mkdir(parents=True, exist_ok=True)
    output = ROOT / 'demo/data/flatmap'
    output.mkdir(parents=True, exist_ok=True)
    provenance, surfaces = [], {}
    for name in ('flat', 'wm', 'pia', 'inflated'):
        path = args.cache / f'{name}_lh.gii'
        url = BASE + f'filestore/db/S1/surfaces/{path.name}'
        if not path.exists():
            path.write_bytes(urllib.request.urlopen(url).read())
        raw = path.read_bytes()
        surfaces[name] = read_surface(path)
        provenance.append({'name': name, 'url': url, 'sha256': sha(raw), 'bytes': len(raw)})
    xy = surfaces['flat'][0][:, :2]
    faces = surfaces['wm'][1]
    for name in ('wm', 'pia', 'inflated'):
        positions, triangles = surfaces[name]
        assert np.isfinite(positions).all() and np.array_equal(faces, triangles)
        u = positions[triangles[:, 1]].astype(float) - positions[triangles[:, 0]]
        v = positions[triangles[:, 2]].astype(float) - positions[triangles[:, 0]]
        assert np.all(np.linalg.norm(np.cross(u, v), axis=1) > 0), name
    lookup = {tuple(sorted(face)): i for i, face in enumerate(faces)}
    flatfaces = surfaces['flat'][1]
    original_ids = np.array([lookup[tuple(sorted(face))] for face in flatfaces], dtype='<u4')
    assert len(np.unique(original_ids)) == len(original_ids)
    u = xy[flatfaces[:, 1]].astype(float) - xy[flatfaces[:, 0]]
    v = xy[flatfaces[:, 2]].astype(float) - xy[flatfaces[:, 0]]
    signed = u[:, 0] * v[:, 1] - u[:, 1] * v[:, 0]
    inverted = np.flatnonzero(signed <= 0)
    good = np.flatnonzero(signed > 0)
    overlap, pair_count = overlapping_faces(xy, flatfaces[good])
    excluded = np.union1d(inverted, good[overlap])
    keep = np.setdiff1d(np.arange(len(flatfaces)), excluded)
    chart_xy, chart_faces, anatomical_vertices, splits = split_chart_fans(xy, flatfaces[keep])
    arrays = {
        'white': surfaces['wm'][0].astype('<f4'), 'pial': surfaces['pia'][0].astype('<f4'),
        'inflated': surfaces['inflated'][0].astype('<f4'), 'coordinates': chart_xy.astype('<f4'),
        'faces': faces.astype('<u4'), 'chartFaces': chart_faces.astype('<u4'), 'anatomicalVertices': anatomical_vertices,
        'anatomicalFaces': original_ids[keep].astype('<u4'),
    }
    chunks, descriptors, offset = [], {}, 0
    for name, array in arrays.items():
        data = array.tobytes(order='C')
        descriptors[name] = {'offset': offset, 'length': array.size, 'type': 'float32' if array.dtype.kind == 'f' else 'uint32'}
        chunks.append(data)
        offset += len(data)
    binary = b''.join(chunks)
    packed = gzip.compress(binary, mtime=0)
    (output / 's1-lh.bin.gz').write_bytes(packed)
    (output / 'LICENSE').write_bytes(urllib.request.urlopen(BASE + 'LICENSE').read())
    manifest = {
        'schema': 'surfview.flatmap-fixture.v1', 'subject': 'pycortex-S1', 'hemisphere': 'left',
        'sourceRevision': REVISION, 'license': 'BSD-2-Clause, repository LICENSE; no separate asset notice found',
        'sources': provenance, 'vertexCount': len(xy), 'faceCount': len(faces), 'chartFaceCount': len(keep),
        'units': 'mm', 'frame': 'pycortex-S1-surface', 'chartUnits': 'arbitrary',
        'chartCalibration': 'display area normalization against represented pial area; not anatomical isometry',
        'correspondence': 'explicit original vertex IDs; disconnected chart fans split without changing coordinates; flat faces verified against anatomical triangles',
        'chartVertexCount': len(chart_xy), 'seamSplits': splits,
        'excludedChartFaces': {'inverted': inverted.tolist(), 'overlapping': good[overlap].tolist(), 'overlapPairs': pair_count,
                               'policy': 'omit all inverted faces and both members of every positive-area overlap among remaining faces; no coordinate repair'},
        'arrays': descriptors, 'file': 's1-lh.bin.gz', 'sha256': sha(packed), 'uncompressedSha256': sha(binary),
        'bytes': len(packed), 'uncompressedBytes': len(binary),
        'thicknessQuantilesMm': np.quantile(np.linalg.norm(surfaces['pia'][0].astype(float) - surfaces['wm'][0], axis=1), [0, .01, .5, .99, 1]).tolist(),
    }
    (output / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
    print(json.dumps({k: manifest[k] for k in ('vertexCount', 'faceCount', 'chartFaceCount', 'bytes', 'uncompressedBytes')}))
    print(f'Excluded {len(inverted)} inverted and {len(overlap)} overlapping chart faces ({pair_count} pairs); original sources unchanged.')


if __name__ == '__main__':
    main()
