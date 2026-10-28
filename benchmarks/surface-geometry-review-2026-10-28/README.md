# Surface geometry review repairs, 2026-10-28

The six review findings are repaired, with 21 additional unit regressions and two additional browser regressions. GPU pixel testing also exposed and fixed black instanced annotation markers. The projection regression includes independent exact-input rational witnesses and a bounded exact-arithmetic fallback for ill-conditioned triangles; the optional binary32 profile is unchanged.

Before committing, `main` was fast-forwarded to upstream `e3501fd1a4cc476b2a1f77315b600e833c8c5173` (figure color-key and GIFTI warning fixes), without conflicts. On the combined tree, all 1,255 unit tests across 109 files, 16 surface-geometry browser tests, TypeScript checking, library builds, and packed-package consumer checks passed. The build includes package declaration and artifact checks.

[receipt.json](receipt.json) binds this validation to the source and generated runtime hashes. Raw logs are retained beside it. Earlier qualification receipts remain historical evidence for their exact recorded snapshots. Workbench numerical qualification, independent ribbon checks and large performance measurements were not rerun as part of this repair and publication check.

The commit excludes unrelated local `.claude/settings.json`, `docs/architecture/cortical-evidence-plan.md`, and `output/` work. No npm release or deployment is included in this publication step.
