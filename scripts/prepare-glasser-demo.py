"""Regenerate the Glasser demo JSON from a pinned upstream Git blob.

Run from any directory with Python 3.9+. No third-party Python packages required.
The downloaded GIFTI hash is checked before any local output is overwritten.
"""
import base64
import hashlib
import json
from pathlib import Path
import struct
import urllib.request
import xml.etree.ElementTree as ET
import zlib

REPO = "canlab/Neuroimaging_Pattern_Masks"
BLOB = "9db4b1adb2317565deb99ee7126d3e1d9d01ac53"
SHA256 = "394e3c5d7342700dba10140a5304570a81590513f9e4ce8a3bc2117a57cf45a6"
SOURCE = ("https://raw.githubusercontent.com/" + REPO + "/master/Atlases_and_parcellations/"
          "2016_Glasser_Nature_HumanConnectomeParcellation/Glasser_2016.32k.L.label.gii")

with urllib.request.urlopen(f"https://api.github.com/repos/{REPO}/git/blobs/{BLOB}") as response:
    source = base64.b64decode(json.load(response)["content"])
if hashlib.sha256(source).hexdigest() != SHA256:
    raise ValueError("Upstream GIFTI digest does not match the pinned fixture")
root = ET.fromstring(source)
array = root.find("DataArray")
assert array is not None
assert array.attrib["Dim0"] == "32492"
assert array.attrib["Endian"] == "LittleEndian"
assert array.attrib["DataType"] == "NIFTI_TYPE_INT32"
labels = list(struct.unpack("<32492i", zlib.decompress(base64.b64decode(array.findtext("Data")))))
parcels = []
for entry in root.findall("./LabelTable/Label"):
    key = int(entry.attrib["Key"])
    if not key or key not in labels:
        continue
    parcels.append({"id": key, "label": entry.text.removeprefix("L_").removesuffix("_ROI"),
                    "hemi": "left", "color": "#" + "".join(
                        f"{round(float(entry.attrib[c]) * 255):02x}" for c in ["Red", "Green", "Blue"])})
assert len(parcels) == 180 and set(labels) == set(range(181))
fixture = {"schema_version": "1.0.0", "atlas": {
    "id": "hcp-mmp1-left-fslr32k", "name": "HCP-MMP1.0", "version": "1.0", "space": "fsLR", "n_parcels": 180},
    "parcels": parcels, "vertexLabels": labels, "source": {
        "url": SOURCE, "git_blob": BLOB, "sha256": SHA256,
        "citation": "Glasser et al. (2016), doi:10.1038/nature18933",
        "license": "Upstream repository GPL-3.0; see LICENSE.txt. Data fixture only, not bundled in the library."}}
target = Path(__file__).resolve().parents[1] / "demo/data/glasser/left-fslr32k.json"
target.write_text(json.dumps(fixture, separators=(",", ":")) + "\n")
print(f"Wrote {target}: 32492 vertices, 180 parcels; source SHA-256 {SHA256}")
