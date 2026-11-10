# Matched S1 cortical geometry

Source: [pycortex](https://github.com/gallantlab/pycortex/tree/1e4c0790b66bcbcd836b5832650908f83327c399/filestore/db/S1/surfaces), example subject S1, left hemisphere. The original flat, white, pial and inflated GIFTI assets are bundled by that project under its repository BSD-2-Clause license, retained in [LICENSE](LICENSE). No separate asset license notice was found in the source subtree. This is real example anatomy, not synthetic white matter or a projection of unrelated subjects. It does not establish registration to any external atlas or volume.

`manifest.json` records pinned source URLs, original checksums, the derived artifact checksums, array layout, counts, coordinate conventions and excluded chart face IDs. Anatomical coordinates remain in the source surface frame; no MNI correspondence is claimed. The GIFTI coordinate-system labels are unknown. Millimetre units follow the source reconstruction convention. Flat coordinates are treated as arbitrary chart units, with explicit area-based display calibration when relief is shown.

The unmodified sources have 152,893 vertices and 305,782 white/pial/inflated faces. The original flat chart retains 291,351 faces, each verified against an anatomical triangle. Its first two coordinates contain 30 inverted faces. Among the remaining faces, an independent positive-area intersection check found 494 overlapping pairs involving 258 faces. The derived chart explicitly omits all 288 defective faces and retains 291,063 faces. Omitted areas are not interpolated or bridged. No coordinates, original vertex IDs or anatomical faces were repaired, resampled or decimated. The unused third flat coordinate is not a height field and is not used.

Removing those faces leaves one vertex with disconnected incident-face fans. The derived chart splits that vertex into two chart copies at identical coordinates, yielding 152,894 chart vertices. Both copies retain the same original anatomical ID in `anatomicalVertices`; the manifest records the affected faces. This is an explicit cut, not a change to anatomical connectivity. Runtime admission requires the resulting chart topology to be manifold.

The gzip file contains little-endian float32 coordinates and uint32 indices at byte offsets specified by the manifest. It preserves original float32 values losslessly. Original GIFTI files are kept in an external cache, not duplicated in this repository. The demonstration uses clearly labeled constructed scalar fields/volumes on this real geometry.

Reproduce with Python 3 and NumPy:

```sh
python scripts/prepare-flatmap-data.py --cache /tmp/surfview-pycortex-review/S1
```

The script downloads pinned originals when absent, verifies anatomical face correspondence and finite/nondegenerate anatomy, independently checks chart overlaps, writes the derived payload and records every exclusion. Restore the originals from the manifest URLs and verify their SHA-256 checksums. Gzip byte identity can depend on the Python/zlib version; the uncompressed checksum and array content are the lossless identity.
