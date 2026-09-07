# Schaefer–Yeo 400 demo data

Real left-hemisphere labels from the authors' [CBIG Schaefer2018 release](https://github.com/ThomasYeoLab/CBIG/tree/master/stable_projects/brain_parcellation/Schaefer2018_LocalGlobal/Parcellations/HCP/fslr32k/cifti),
with Yeo 7- and 17-network assignments. Each file contains 32,492 fsLR vertices,
200 parcels, original parcel IDs, full source names, and source colors. The
400-parcel atlas has 200 parcels in each hemisphere. This demo shows the left.

The CIFTI BrainModel vertex mapping is applied explicitly; medial-wall vertices
remain zero. Use these labels only with corresponding fsLR 32k geometry and
vertex ordering. Files are demo assets and are not included in the npm library.

Regenerate with `python3 scripts/prepare-schaefer-demo.py`. That script downloads
immutable Git blobs, verifies SHA-256 digests, checks the CIFTI layout, and records
the hashes in the JSON. It also retrieves the pinned upstream MIT license.

Sources: Schaefer et al. (2018), [doi:10.1093/cercor/bhx179](https://doi.org/10.1093/cercor/bhx179);
Yeo et al. (2011), [doi:10.1152/jn.00338.2011](https://doi.org/10.1152/jn.00338.2011).
The upstream copyright and permission notice is in [LICENSE.txt](LICENSE.txt).
