"""Extract left fsLR 32k Schaefer 400 fixtures from pinned CBIG CIFTI files.

Python 3.9+, standard library only. This deliberately handles only the verified
layout of these two source files, not arbitrary CIFTI. BrainModel vertex indices
are used explicitly; medial-wall zeros and source parcel IDs are preserved.
"""
import base64
import hashlib
import json
from pathlib import Path
import struct
import urllib.request
import xml.etree.ElementTree as ET

SOURCES = {
    7: ("d803a04005997b473712be6f99c87c2f641f72e2", "a567348a2ac3fb344eead6ae1768f889ebb98327985db67b9493476cd3d390d0"),
    17: ("1c05a9c11f4744ed1eced68f52087c5a53db34cc", "0a5c9eb5e408f1570eae3a846c9e5bb664378b0fa5b96b889b8200d15497f78c"),
}
LICENSE = ("09a7f8cd58222885cd9f32aa0d76e20870d660ab", "0e38f0e8b304f13de2ce2911320faaa08ced178e031d3bbebc3e4769762e5f50")
TARGET = Path(__file__).resolve().parents[1] / "demo/data/schaefer"


def download(blob, digest):
    url = f"https://api.github.com/repos/ThomasYeoLab/CBIG/git/blobs/{blob}"
    with urllib.request.urlopen(url) as response:
        raw = base64.b64decode(json.load(response)["content"])
    if hashlib.sha256(raw).hexdigest() != digest:
        raise ValueError(f"Source digest mismatch for {blob}")
    return raw, url


TARGET.mkdir(parents=True, exist_ok=True)
for networks, (blob, digest) in SOURCES.items():
    raw, url = download(blob, digest)
    assert struct.unpack_from("<i", raw)[0] == 540  # NIfTI-2, little endian
    assert struct.unpack_from("<h", raw, 12)[0] == 16  # float32 label keys
    assert struct.unpack_from("<8q", raw, 16) == (6, 1, 1, 1, 1, 1, 64984, 1)
    offset = struct.unpack_from("<q", raw, 168)[0]
    assert struct.unpack_from("<2i", raw, 544) == (offset - 544, 32)
    root = ET.fromstring(raw[552:offset].rstrip(b"\0"))
    model = root.find(".//BrainModel[@BrainStructure='CIFTI_STRUCTURE_CORTEX_LEFT']")
    assert model is not None and model.attrib["SurfaceNumberOfVertices"] == "32492"
    start, count = int(model.attrib["IndexOffset"]), int(model.attrib["IndexCount"])
    indices = [int(v) for v in model.findtext("VertexIndices").split()]
    assert len(indices) == count and len(set(indices)) == count
    labels = [0] * 32492
    values = struct.unpack_from(f"<{count}f", raw, offset + start * 4)
    for vertex, value in zip(indices, values):
        assert 0 <= vertex < 32492 and value == int(value) and 0 <= value <= 200
        labels[vertex] = int(value)
    assert set(labels) == set(range(201))
    parcels = []
    for entry in root.findall(".//LabelTable/Label"):
        key = int(entry.attrib["Key"])
        if key not in range(1, 201):
            continue
        assert entry.text.startswith(f"{networks}Networks_LH_")
        parcels.append({"id": key, "label": entry.text, "hemi": "left", "color": "#" + "".join(
            f"{round(float(entry.attrib[c]) * 255):02x}" for c in ["Red", "Green", "Blue"])})
    assert len(parcels) == 200
    fixture = {"schema_version": "1.0.0", "atlas": {
        "id": f"schaefer400-{networks}-left-fslr32k", "name": f"Schaefer–Yeo 400 · {networks} networks",
        "space": "fsLR", "n_parcels": 200}, "parcels": parcels, "vertexLabels": labels,
        "source": {"url": url, "git_blob": blob, "sha256": digest,
                   "file": f"Schaefer2018_400Parcels_{networks}Networks_order.dlabel.nii",
                   "citation": "Schaefer et al. (2018), doi:10.1093/cercor/bhx179; Yeo et al. (2011), doi:10.1152/jn.00338.2011",
                   "license": "MIT, Copyright (c) 2016 Computational Brain Imaging Group (CBIG); see LICENSE.txt."}}
    target = TARGET / f"left-fslr32k-{networks}networks.json"
    target.write_text(json.dumps(fixture, separators=(",", ":")) + "\n")
    print(f"Wrote {target}: 32492 vertices, 200 left-hemisphere parcels")
license_text, _ = download(*LICENSE)
(TARGET / "LICENSE.txt").write_bytes(license_text)
