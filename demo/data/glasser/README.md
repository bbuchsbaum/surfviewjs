# Glasser atlas demo fixture

`left-fslr32k.json` contains all 32,492 left-hemisphere vertex labels and the
180 parcel names/colors from `Glasser_2016.32k.L.label.gii` in the
[CANlab Neuroimaging Pattern Masks repository](https://github.com/canlab/Neuroimaging_Pattern_Masks/blob/master/Atlases_and_parcellations/2016_Glasser_Nature_HumanConnectomeParcellation/Glasser_2016.32k.L.label.gii).

Source Git blob: `9db4b1adb2317565deb99ee7126d3e1d9d01ac53`.
Source file SHA-256: `394e3c5d7342700dba10140a5304570a81590513f9e4ce8a3bc2117a57cf45a6`.

Conversion: decode the GIFTI little-endian int32 GZipBase64 array, retain every
vertex label unchanged (0 is the medial wall), retain parcel IDs 1–180, remove
the `L_`/`_ROI` display-name affixes, and round the source RGB table to 8-bit hex.
No resampling, geometric deformation, or parcel relabeling was performed.
Regenerate with `python3 scripts/prepare-glasser-demo.py`; the script downloads
the immutable Git blob and verifies its SHA-256 before replacing the fixture.
Pair with the existing `tests/data/fs_LR.32k.L.inflated.surf.gii` fixture, whose
metadata identifies HCP fsaverage_LR32k coordinates and 32,492 vertices.

Citation: Glasser MF et al. (2016), *A multi-modal parcellation of human cerebral
cortex*, Nature 536, 171–178. <https://doi.org/10.1038/nature18933>.

The upstream repository distributes this asset under GPL-3.0; its license is
reproduced in `LICENSE.txt`. This separately attributed demo data is not part of
the MIT library bundle. The paper-style orange/peach highlights and synthetic
example values are illustrative demo choices, not the concordance findings in
Nieuwenhuys et al. (2024).
