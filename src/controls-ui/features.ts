export const SURFVIEW_CONTROLS_FEATURES = Object.freeze([
  'view',
  'layers',
  'layer-inspector',
  'selection',
  'figure'
] as const);

export type SurfViewControlsFeature = typeof SURFVIEW_CONTROLS_FEATURES[number];

export interface SurfViewControlsFeatureOptions {
  /** Features rendered by this control surface, in canonical panel order. */
  readonly include?: readonly SurfViewControlsFeature[];
}

const ALL_FEATURES: SurfViewControlsFeatureOptions = Object.freeze({
  include: SURFVIEW_CONTROLS_FEATURES
});

export function normalizeSurfViewControlsFeatures(
  options: SurfViewControlsFeatureOptions | undefined
): SurfViewControlsFeatureOptions {
  if (!options?.include) return ALL_FEATURES;
  const requested = new Set(options.include);
  return Object.freeze({
    include: Object.freeze(
      SURFVIEW_CONTROLS_FEATURES.filter(feature => requested.has(feature))
    )
  });
}
